# Clearinghouse

## Today

- The worker uploads 837P files to the clearinghouse SFTP server and polls its download folders (`apps/worker/src/features/clearinghouse`).
- Response files are recognized by content (ISA/GS/ST), routed to an agency by ISA08 (the agency's submitter ID) and applied by `billing.receive-payer-file`.
- One connection, configured by `CLEARINGHOUSE_*` environment variables, serves every agency.
- `.dev/mock-clearinghouse.ts` answers uploads with a 999, a 277CA per claim, and an 835 after `CLEARINGHOUSE_REMIT_DELAY_SECONDS`.
- 270s are generated for download only; 276/277 and real-time exchanges are not built.

## Waystar conventions

Most of Waystar's interface documentation sits behind its developer portal login. What is public:

| Item                                       | Value                                                                         | Confidence                  |
| ------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------- |
| SFTP host                                  | `sshftp.waystar.com` (also `sshftp.zirmed.com`)                               | Verified by several vendors |
| Folders                                    | write-only `/upload`, readable `/download`                                    | Verified by vendors         |
| 837P file name                             | `<base>.CLP`, no extra periods in the base                                    | Verified by vendors         |
| Other uploads                              | `.CLI` 837I, `.CLD` 837D, `.ELG` batch 270                                    | One third-party source      |
| ISA08 / GS03 / 1000B                       | `WAYSTAR` (older accounts `ZIRMED`)                                           | Waystar companion guide     |
| ISA06 / GS02 / 1000A NM109                 | Your Waystar client account ID                                                | Waystar companion guide     |
| Submitter identity                         | Taken from the SFTP account, not the envelope                                 | Waystar companion guide     |
| Claim total                                | Waystar recomputes CLM02 from the lines; fills SBR09 from its payer table     | Waystar companion guide     |
| Enrollment                                 | Claims, ERA and EFT enrolled per payer; no 835 without ERA enrollment         | Verified                    |
| Response file names (999, 277CA, TA1, 835) | Not public; sources disagree on the 835 extension                             | Match by content            |
| Real-time eligibility and claim status     | HTTPS APIs (HMAC-signed web services, CAQH CORE likely); endpoints not public | Assumed                     |

## Target design

- A `Clearinghouse` port with operations, not transports: submit claims, check eligibility (real-time or batch), check claim status, discover insurance, poll responses.
- Adapters: SFTP batch (today), the mock, and Waystar's API.
- A connection per agency (settings with encrypted secrets); environment variables remain the dev default.
- The mock follows Waystar's folders, `.CLP` naming, envelope IDs and enrollment rules, and also answers 270 and 276 in batch and through a CORE-style real-time endpoint, so switching to Waystar is a configuration change.
