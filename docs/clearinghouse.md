# Clearinghouse

## The port

`Clearinghouse` (`libs/domain/billing/src/clearinghouse.ts`) is an operations port, not a transport:

| Operation                             | Does                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------- |
| `submitClaims`                        | Uploads an 837P batch file, named with the connection's claim extension    |
| `submitEligibility`                   | Uploads a batch 270; the 271 arrives with the other downloads              |
| `checkEligibility`                    | Real-time 270 → 271 text or an error (`null` when the connection has none) |
| `submitClaimStatus`                   | Uploads a batch 276; the 277 arrives with the other downloads              |
| `checkClaimStatus`                    | Real-time 276 → 277 text or an error (`null` without real time)            |
| `pollResponses`, `download`, `remove` | Lists, reads and deletes response files; `afterDownload` says delete/keep  |

`createClearinghouse` composes it from two transports, both domain-free adapters in `libs/platform/clearinghouse` (`@ugula/clearinghouse`):

- `sftp-batch`: one SFTP session per operation (`ssh2-sftp-client`), an upload folder and any number of download folders.
- `core-realtime`: a CAQH CORE Connectivity vC2.2.0 client. It posts a `multipart/form-data` envelope (`PayloadType`, `ProcessingMode=RealTime`, `PayloadID`, `TimeStamp`, `SenderID`, `ReceiverID`, `CORERuleVersion=2.2.0`, `Payload`) with HTTP Basic auth and a timeout, and returns the payload or an error (HTTP status, `ErrorCode`/`ErrorMessage`, a different `PayloadID`, a timeout). The domain maps 270 to `X12_270_Request_005010X279A1` / `X12_271_Response_005010X279A1` and 276 to `X12_276_Request_005010X212` / `X12_277_Response_005010X212`.
- `secrets`: AES-256-GCM sealing of connection passwords, with the agency ID as associated data so a sealed password only opens for its agency.

## Connections

- Each agency can have one row in `clearinghouse_connections` (Settings → Clearinghouse Connection, permission `settings:update`): vendor (`waystar`, `mock` or `custom-sftp`, each a preset in `VENDOR_PRESETS`), on or paused, SFTP host, port, username and password, upload and download folders, the 837P, 270 and 276 extensions, delete or keep after download, and an optional CORE real-time URL. The real-time client uses the SFTP username and password (an MVP assumption; Waystar may issue separate API credentials) and sends the billing profile's submitter ID as `SenderID`.
- The password is sealed with `CLEARINGHOUSE_SECRET_KEY` (32 random bytes, base64) before it is stored. The key is parsed only in the api and worker composition roots. The API never returns the password, only `secret_set`; leaving the field blank keeps it. Without the key the API refuses to store passwords and the worker skips agency connections.
- Agencies without a row use the `CLEARINGHOUSE_*` connection from the worker's environment (the dev default); leave `CLEARINGHOUSE_SFTP_HOST` empty for none. Without any connection, 837P files wait on the claim for a biller and eligibility checks say why they cannot run (the 270 can still be downloaded).

## Polling and routing

- Every `CLEARINGHOUSE_POLL_MINUTES` the worker lists the download folders of the default connection and every enabled agency connection, once per distinct `username@host:port` and folders (agencies sharing an account are polled once).
- Each new file (by connection, path, size and modification time, `clearinghouse_downloads`) is recognized by content (ISA/GS/ST), routed to the agency whose billing profile submitter ID is the interchange receiver (ISA08) and starts `billing.receive-payer-file`. Files no single agency takes stay on the server with a note.
- Kinds: 835, 999, 277CA (`005010X214`, kind `277`), 271, TA1 (an interchange with a `TA1` segment and no transaction set) and 277 claim status (`005010X212`, kind `277S`). Payer Files lists them all with `PAYER_FILE_LABELS`.

## What each answer does

- **TA1**: an accepted interchange is recorded; a rejected one marks the 837P batch with that ISA13 control number rejected (`claim_batches.rejected_at`, `rejection`), sends each of its claims back to review like a 999 rejection ("The clearinghouse rejected the file envelope of 837P file N: reason"), and `Receive Payer File` opens a **Fix clearinghouse setup** task naming the reason, since an envelope problem is setup, not claim data.
- **271**: active or inactive coverage on the traced claim payer (an inactive coverage blocks billing that payer) and an eligibility event in the claim History. A Medicare answer (payer claim filing MA/MB) that names a Medicare Advantage plan (`EB*R` with HM, HN, PR or PS, plan from the 2120C `NM1*PRP/PR/P3` or EB05) becomes a review line: "Bill the Medicare Advantage plan instead: plan".
- **277 claim status**: a `claim_status` event per claim (category, code and text, and the payer claim number), shown in History and in the follow-up task.

## Eligibility and claim status requests

- `billing.check-eligibility` runs `Check Eligibility with Clearinghouse` (`billing.send-270`): real time when the connection has a real-time URL, applying the 271 at once as a payer file; otherwise, or when real time fails, a batch `.ELG` upload. It starts when Encounter to Claim saves a claim's payers and from **Check Eligibility** on a claim; **Download 270** still builds the file for a biller.
- `Follow Up with Payer` first runs `Check Claim Status with Clearinghouse` (`billing.send-276`): real time, or a batch `.CLS` upload followed by a wait of up to a day for the claim to change, then shows the latest status in the follow-up task.

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

`.dev/mock-clearinghouse.ts` follows these conventions (see the README's Mock clearinghouse section): `.CLP` claims, `.ELG` batch 270s and `.CLS` batch 276s in `/upload`, answers in `/download`, a `.TA1` for an interchange not addressed to Waystar, and `POST /core/realtime` answering 270 and 276. It remembers each claim it saw: a 276 is answered in process (A2) once accepted, paid (F1) once its 835 went out, rejected (A3) or not found (A4).

## Later

Insurance discovery, Waystar's own API adapter, separate real-time credentials and proprietary front-end rejection reports.
