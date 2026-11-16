import {
  type Hospital,
  isRurality,
  type MedicareFee,
  type MedicareLocality,
  type Rurality
} from '@ugula/billing';
import type { Database } from '@ugula/db';
import type { Kysely } from 'kysely';
import { BATCH, inBatches, truncate, tsvRows } from './tsv.ts';

type Locality = Omit<MedicareLocality, 'plusFourNeeded'>;

type ZipLocality = Locality & { postalCode: string; needsPlusFour: boolean };

type Zip4Locality = Locality & { postalCode: string; plusFourFrom: string; plusFourTo: string };

type AmbulanceFee = MedicareFee & { year: number; carrier: string; locality: string };

type CmsData = {
  zips: ZipLocality[];
  zip4s: Zip4Locality[];
  fees: AmbulanceFee[];
  hospitals: Omit<Hospital, 'similarity'>[];
};

export const CMS_FILES: Record<keyof CmsData, URL> = {
  zips: new URL('./data/cms-zip-localities.tsv.gz', import.meta.url),
  zip4s: new URL('./data/cms-zip4-localities.tsv.gz', import.meta.url),
  fees: new URL('./data/cms-ambulance-fees.tsv.gz', import.meta.url),
  hospitals: new URL('./data/cms-hospitals.tsv.gz', import.meta.url)
};

const ruralityOf = (x: string | undefined): Rurality => {
  if (!isRurality(x)) throw new Error(`Unknown rurality ${x}`);
  return x;
};

const requiredNumber = (x: string | undefined) => {
  const n = Number(x);
  if (!x || !Number.isInteger(n)) throw new Error(`Expected a whole number, got ${x}`);
  return n;
};

const centsOrNull = (x: string | undefined) => (x ? requiredNumber(x) : null);

export const readCmsData = (files: Record<keyof CmsData, Buffer>): CmsData => ({
  zips: tsvRows(files.zips).map(([postalCode = '', carrier = '', locality = '', r, p]) => ({
    postalCode,
    carrier,
    locality,
    rurality: ruralityOf(r),
    needsPlusFour: p === '1'
  })),
  zip4s: tsvRows(files.zip4s).map(
    ([postalCode = '', plusFourFrom = '', plusFourTo = '', carrier = '', locality = '', r]) => ({
      postalCode,
      plusFourFrom,
      plusFourTo,
      carrier,
      locality,
      rurality: ruralityOf(r)
    })
  ),
  fees: tsvRows(files.fees).map(([year, carrier = '', locality = '', code = '', u, r, s, t]) => ({
    year: requiredNumber(year),
    carrier,
    locality,
    code,
    urbanCents: requiredNumber(u),
    ruralCents: requiredNumber(r),
    superRuralCents: centsOrNull(s),
    ruralShortTripCents: centsOrNull(t)
  })),
  hospitals: tsvRows(files.hospitals).map(
    ([
      ccn = '',
      name = '',
      addressLine = '',
      city = '',
      state = '',
      postalCode = '',
      phone,
      kind = '',
      er
    ]) => ({
      ccn,
      name,
      addressLine,
      city,
      state,
      postalCode,
      phone: phone || null,
      hospitalType: kind,
      emergencyServices: er === '1'
    })
  )
});

export const replaceCmsData = async (db: Kysely<Database>, data: CmsData) => {
  await truncate(db, [
    'cms_zip4_localities',
    'cms_zip_localities',
    'cms_ambulance_fees',
    'cms_hospitals'
  ]);
  await inBatches(data.zips, BATCH, (rows) =>
    db
      .insertInto('cms_zip_localities')
      .values(
        rows.map((r) => ({
          postal_code: r.postalCode,
          carrier: r.carrier,
          locality: r.locality,
          rurality: r.rurality,
          needs_plus_four: r.needsPlusFour
        }))
      )
      .execute()
  );
  await inBatches(data.zip4s, BATCH, (rows) =>
    db
      .insertInto('cms_zip4_localities')
      .values(
        rows.map((r) => ({
          postal_code: r.postalCode,
          plus_four_from: r.plusFourFrom,
          plus_four_to: r.plusFourTo,
          carrier: r.carrier,
          locality: r.locality,
          rurality: r.rurality
        }))
      )
      .execute()
  );
  await inBatches(data.fees, BATCH, (rows) =>
    db
      .insertInto('cms_ambulance_fees')
      .values(
        rows.map((r) => ({
          year: r.year,
          carrier: r.carrier,
          locality: r.locality,
          code: r.code,
          urban_cents: r.urbanCents,
          rural_cents: r.ruralCents,
          super_rural_cents: r.superRuralCents,
          rural_short_trip_cents: r.ruralShortTripCents
        }))
      )
      .execute()
  );
  await inBatches(data.hospitals, BATCH, (rows) =>
    db
      .insertInto('cms_hospitals')
      .values(
        rows.map((r) => ({
          ccn: r.ccn,
          name: r.name,
          address_line: r.addressLine,
          city: r.city,
          state: r.state,
          postal_code: r.postalCode,
          phone: r.phone,
          hospital_type: r.hospitalType,
          has_emergency_services: r.emergencyServices
        }))
      )
      .execute()
  );
};
