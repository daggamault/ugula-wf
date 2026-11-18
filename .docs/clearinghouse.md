# Clearinghouse

What exists today is the agency connection, the X12 builders and readers the mock uses, the mock itself, and claim submission: **Send Claim** uploads each approved claim as an 837P over SFTP. Acknowledgments, eligibility, claim status and remittance are rebuilt on the [workflow](workflows.md) model next, each started from an event.

## Sending claims

Approving a claim emits `claim.approved`, which starts **Send Claim**. Its Send Claim node (worker `features/claims/send.ts`) locks the claim, and while it is still approved builds one 837P for it, billed to its first payer, from the claim as billed, its directory payer and the billing profile. Each file gets the next interchange control number of the agency (ISA13, GS06 and BHT03) and is named `<submitter ID><control number, 9 digits><837P extension>` (`SUB01000000042.CLP`), with no other periods. The file is kept in `claim_submissions` before it is uploaded, so a run retried after a failed upload sends the same file under the same number. The worker opens the connection password with `CLEARINGHOUSE_SECRET_KEY`, checks the server presents the pinned host key, writes the file to the upload folder and marks the claim **Sent**. A claim the patient pays is not sent; a claim missing something, or an agency with no active connection, stops the run for a person to fix and retry. A claim already sent is never rebuilt: a revised PCR leaves it as sent and asks a biller to correct it with the payer (Correct the Sent Claim), and it can no longer be edited.

## What is kept

- `libs/platform/clearinghouse` (`@ugula/clearinghouse`): `secrets`, AES-256-GCM sealing of connection passwords as `v1.<key id>.<iv>.<tag>.<body>`, with the agency ID as associated data so a sealed password only opens for its agency, and a keyring so a password sealed with a previous key opens until it is saved again; and `host-key`, the SHA256 fingerprint of an SSH host key.
- `libs/domain/billing`: the 837P builder and the 270, 271, 276, 277, 277CA, 835 and 999 readers and builders, which the mock produces and its tests read back.

## Connections

- Each agency can have one row in `clearinghouse_connections` (Settings → Clearinghouse Connection, permission `settings:update`): vendor (`waystar`, `mock` or `custom-sftp`, each a preset in `VENDOR_PRESETS`), on or paused, SFTP host, port, host key fingerprint (`SHA256:…`, required; only the mock preset fills it), username and password, upload and download folders, the 837P, 270 and 276 extensions, delete or keep after download, and an optional CORE real-time URL.
- A paused connection will exchange nothing for its agency.
- Outside `NODE_ENV=development` the API refuses the mock vendor, SFTP hosts and real-time URLs on loopback, private, link-local or local names, and real-time URLs that are not https.
- The password is sealed with `CLEARINGHOUSE_SECRET_KEY` (32 random bytes, base64; rotate by moving the old key to `CLEARINGHOUSE_PREVIOUS_SECRET_KEYS`) before it is stored. The key is parsed only in the API's composition root. The API never returns the password, only `secret_set`; leaving the field blank keeps it, but only while the host, port, host key, username and real-time URL stay the same, so a stored password is never sent to a server it was not entered for. Without the key the API refuses to store passwords.

## Waystar conventions

Most of Waystar's interface documentation sits behind its developer portal login. What is public:

| Item                                       | Value                                                                     | Confidence                  |
| ------------------------------------------ | ------------------------------------------------------------------------- | --------------------------- |
| SFTP host                                  | `sshftp.waystar.com` (also `sshftp.zirmed.com`)                           | Verified by several vendors |
| Folders                                    | write-only `/upload`, readable `/download`                                | Verified by vendors         |
| 837P file name                             | `<base>.CLP`, no extra periods in the base                                | Verified by vendors         |
| Other uploads                              | `.CLI` 837I, `.CLD` 837D, `.ELG` batch 270                                | One third-party source      |
| Batch 276 extension                        | `.CLS`                                                                    | **Assumed**; confirm        |
| ISA08 / GS03 / 1000B                       | `WAYSTAR` (older accounts `ZIRMED`)                                       | Waystar companion guide     |
| ISA06 / GS02 / 1000A NM109                 | Your Waystar client account ID                                            | Waystar companion guide     |
| Submitter identity                         | Taken from the SFTP account, not the envelope                             | Waystar companion guide     |
| Claim total                                | Waystar recomputes CLM02 from the lines; fills SBR09 from its payer table | Waystar companion guide     |
| Enrollment                                 | Claims, ERA and EFT enrolled per payer; no 835 without ERA enrollment     | Verified                    |
| Response file names (999, 277CA, TA1, 835) | Not public; sources disagree on the 835 extension                         | Match by content            |
| Real-time eligibility and claim status     | HTTPS APIs (CAQH CORE likely); endpoints and credentials not public       | Assumed                     |

The Waystar preset fills these folders and extensions with receiver ID `WAYSTAR`; set the billing profile Receiver ID to match.

## The mock

`apps/chouse` follows these conventions (see [Mock clearinghouse](#mock-clearinghouse)), with a host key derived from a fixed seed so its fingerprint is always `MOCK_HOST_KEY`: `.CLP` claims, `.ELG` batch 270s and `.CLS` batch 276s in `/upload`, answers in `/download`, a `.TA1` for an interchange not addressed to Waystar, and `POST /core/realtime` answering 270 and 276. It remembers each claim it saw: a 276 is answered in process (A2) once accepted, paid (F1) once its 835 went out, rejected (A3) or not found (A4).

## Later

Waystar's own API adapter (including its insurance discovery product behind `discoverCoverage`), separate real-time credentials and proprietary front-end rejection reports.

## Pointing at a clearinghouse

| Setting             | Mock                                  | TriZetto                               | Waystar                       |
| ------------------- | ------------------------------------- | -------------------------------------- | ----------------------------- |
| SFTP host and port  | `localhost` / `2223`                  | from your TriZetto setup               | `sshftp.waystar.com` / `22`   |
| Host key            | the mock's fixed `SHA256:VM15…`       | from TriZetto                          | from Waystar                  |
| Upload folder       | `/upload`                             | the upload folder they give you        | `/upload` (write-only)        |
| Download folders    | `/download`                           | one folder each for 999, 277CA and 835 | `/download`                   |
| 837P extension      | `.CLP`                                | `.txt`                                 | `.CLP`                        |
| Batch 270 extension | `.ELG`                                | `.txt`                                 | `.ELG`                        |
| Batch 276 extension | `.CLS`                                | `.txt`                                 | `.CLS` (assumed; confirm)     |
| After download      | delete                                | delete                                 | delete or keep                |
| Real-time URL       | `http://localhost:2224/core/realtime` | empty (batch only)                     | from Waystar (not public yet) |

Each agency's billing profile submitter ID must be the ID the clearinghouse addresses its responses to (its Receiver ID is `WAYSTAR` for Waystar). Confirm folder names, extensions, IDs and real-time credentials with the clearinghouse during enrollment.

## Mock clearinghouse

`apps/chouse` is a dev-only, in-memory clearinghouse that follows Waystar's conventions, so moving to Waystar is a settings change. `pnpm dev` starts it (`pnpm --filter @ugula/chouse dev` alone): SFTP on `CLEARINGHOUSE_SFTP_HOST`:`CLEARINGHOUSE_SFTP_PORT` for `CLEARINGHOUSE_SFTP_USERNAME` / `CLEARINGHOUSE_SFTP_PASSWORD`, and CORE real-time eligibility and claim status on `CHOUSE_REALTIME_PORT`. Files and claim states live in memory and are gone on restart. Its host key is derived from a fixed seed, so its fingerprint never changes: `MOCK_HOST_KEY` in `@ugula/billing`, which the mock preset and `.env.example` pin.

- Upload to the write-only `/upload` folder: 837P files as `<name>.CLP`, batch 270s as `<name>.ELG`, batch 276s as `<name>.CLS`, with no other periods in the name (`.part`, `.tmp` and `.filepart` uploads wait until renamed). About 2s later the file is picked up and removed.
- Answers arrive in `/download` as `<ISA06>_<type>_<yyyyMMddHHmmss>_<seq>.<ext>` and are recognized by content:
  - an interchange not addressed to `WAYSTAR` or `ZIRMED` (ISA08) gets a rejected `.TA1` and nothing else;
  - `.999` acknowledges the group (AK1 = the 837 GS06); an unreadable 837P gets a rejected 999 (`AK9*R`);
  - `.277` (277CA) has one status per claim (TRN = CLM01): accepted, or rejected with "Invalid member ID" when the subscriber member ID starts with `REJECT`;
  - `.835` follows after `CHOUSE_REMIT_DELAY_SECONDS` (default 20) for accepted claims, one transaction per payer, 80% paid and the rest a CO-45, except payers listed in `CHOUSE_ERA_UNENROLLED` (no ERA enrollment, so no 835);
  - `.271` answers each 270 inquiry: a search without a member ID finds the insured on its roster by payer, name and birth date (Kenji Nakamura, born 1995-05-27, the patient of `.xmls/short-trip-self-pay.xml`, at `DEMOBCBS`, the dev Blue Plan, which accepts searches) with member ID, group and plan, or says subscriber not found (AAA 75); otherwise active coverage, inactive when the member ID starts with `INACTIVE`, naming a Medicare Advantage plan when it starts with `ADVANTAGE`, and reporting a hospital inpatient or SNF stay admitted on the date of service when it starts with `INPATIENT` or `SNF`;
  - `.277` (claim status, 005010X212) answers each 276: in process (A2) for an accepted claim, paid (F1) once its 835 went out, rejected (A3), or not found (A4) for a claim it never saw.
- `POST /core/realtime` takes a CAQH CORE multipart envelope (Basic auth, `PayloadType` `X12_270_Request_005010X279A1` or `X12_276_Request_005010X212`) and returns the 271 or 277 in the same envelope.

The answers come from the Waystar mock in `@ugula/billing/testing`. To send claims to it in development, set the agency's connection to the mock preset in Settings with the `CLEARINGHOUSE_SFTP_USERNAME` and `CLEARINGHOUSE_SFTP_PASSWORD` of `.env`, and give the billing profile a submitter ID.
