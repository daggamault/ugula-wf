import { createECDH, createHash, createPrivateKey } from 'node:crypto';
import { MOCK_HOST_KEY } from '@ugula/billing';
import { hostKeyFingerprint } from '@ugula/clearinghouse';
import ssh2 from 'ssh2';

const HOST_KEY_SEED = 'ugula mock clearinghouse host key';

export const stableHostKey = () => {
  const d = createHash('sha256').update(HOST_KEY_SEED).digest();
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const point = ecdh.getPublicKey();
  const pem = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: d.toString('base64url'),
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url')
    }
  })
    .export({ type: 'sec1', format: 'pem' })
    .toString();
  const parsed = ssh2.utils.parseKey(pem);
  if (parsed instanceof Error) throw parsed;
  const fingerprint = hostKeyFingerprint(parsed.getPublicSSH());
  if (fingerprint !== MOCK_HOST_KEY) {
    throw new Error(`The mock host key is ${fingerprint}, not MOCK_HOST_KEY ${MOCK_HOST_KEY}`);
  }
  return pem;
};
