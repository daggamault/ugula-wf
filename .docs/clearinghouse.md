# Clearinghouse

## The port

`Clearinghouse` (`libs/domain/billing/src/clearinghouse.ts`) is an operations port, not a transport:

| Operation           | Does                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `submitClaims`      | Uploads an 837P batch file, named with the connection's claim extension                    |
| `submitEligibility` | Uploads a batch 270; the 271 arrives with the other downloads                              |
| `checkEligibility`  | Real-time 270 → 271 text or an error (`null` when the connection has none)                 |
| `submitClaimStatus` | Uploads a batch 276; the 277 arrives with the other downloads                              |
| `checkClaimStatus`  | Real-time 276 → 277 text or an error (`null` without real time)                            |
| `inbox`             | Lists, reads and deletes response files over one session; `afterDownload` says delete/keep |

`createClearinghouse` composes it from two transports, both domain-free adapters in `libs/platform/clearinghouse` (`@ugula/clearinghouse`):

- `sftp-batch`: SFTP (`ssh2-sftp-client`) with an upload folder and any number of download folders: one session per upload and one per poll of a connection. It accepts only the server whose host key matches the pinned SHA256 fingerprint (and names the key it saw when another answers), gives every operation a deadline (60s) on top of SSH keepalives, and uploads under `<name>.part` before renaming the file into place, so the clearinghouse never picks up half a file.
- `core-realtime`: a CAQH CORE Connectivity vC2.2.0 client. It posts a `multipart/form-data` envelope (`PayloadType`, `ProcessingMode=RealTime`, `PayloadID`, `TimeStamp`, `SenderID`, `ReceiverID`, `CORERuleVersion=2.2.0`, `Payload`) with HTTP Basic auth and a timeout, and returns the payload or an error (HTTP status, `ErrorCode`/`ErrorMessage`, a different `PayloadID`, a timeout). The domain maps 270 to `X12_270_Request_005010X279A1` / `X12_271_Response_005010X279A1` and 276 to `X12_276_Request_005010X212` / `X12_277_Response_005010X212`.
- `secrets`: AES-256-GCM sealing of connection passwords as `v1.<key id>.<iv>.<tag>.<body>`, with the agency ID as associated data so a sealed password only opens for its agency. The key id is derived from the key, so a keyring of the current key and any previous ones opens every password; the worker seals passwords from a previous key again with the current one on its next poll.

## Connections

- Each agency can have one row in `clearinghouse_connections` (Settings → Clearinghouse Connection, permission `settings:update`): vendor (`waystar`, `mock` or `custom-sftp`, each a preset in `VENDOR_PRESETS`), on or paused, SFTP host, port, host key fingerprint (`SHA256:…`, required; only the mock preset fills it), username and password, upload and download folders, the 837P, 270 and 276 extensions, delete or keep after download, and an optional CORE real-time URL. The real-time client uses the SFTP username and password (an MVP assumption; Waystar may issue separate API credentials) and sends the billing profile's submitter ID as `SenderID` and its receiver ID as `ReceiverID`.
- A paused connection exchanges nothing for its agency: no uploads, no real-time checks and no polling; the server default does not stand in for it.
- Outside `NODE_ENV=development` the API refuses the mock vendor, SFTP hosts and real-time URLs on loopback, private, link-local or local names, and real-time URLs that are not https.
- The password is sealed with `CLEARINGHOUSE_SECRET_KEY` (32 random bytes, base64) before it is stored. The key is parsed only in the api and worker composition roots. The API never returns the password, only `secret_set`; leaving the field blank keeps it, but only while the host, port, host key, username and real-time URL stay the same, so a stored password is never sent to a server it was not entered for. Without the key the API refuses to store passwords and the worker skips agency connections.
- Agencies without a row use the `CLEARINGHOUSE_*` connection from the worker's environment (the dev default, pinned with `CLEARINGHOUSE_SFTP_HOST_KEY`); leave `CLEARINGHOUSE_SFTP_HOST` empty for none. Without any connection, 837P files wait on the claim for a biller and eligibility checks say why they cannot run (the 270 can still be downloaded).

## Polling and routing

- Every `CLEARINGHOUSE_POLL_MINUTES` the worker lists the download folders of the default connection and every enabled agency connection, once per distinct `username@host:port` and folders (agencies sharing an account are polled once).
- Each new file (by connection, path, size and modification time, `clearinghouse_downloads`) is recognized by content (ISA/GS/ST), routed to the agency whose billing profile submitter ID is the interchange receiver (ISA08) and starts `billing.receive-payer-file`; it is stored under a key that includes a hash of its remote path, so files with the same name in two folders never overwrite each other. A file from an agency's own connection only goes to an agency using that connection; only the server default routes to any agency.
- A file no single agency takes (not X12, no or several agencies with that submitter ID, the workflow not published) stays on the server and its `clearinghouse_downloads` row keeps the reason but no run. The worker tries it again at most once an hour (`clearinghouse_downloads.tried_at`), logging the reason only when it changes, so fixing a submitter ID or publishing the workflow picks it up within the hour.
- Kinds: 835, 999, 277CA (`005010X214`, kind `277`), 271, TA1 (an interchange with a `TA1` segment and no transaction set) and 277 claim status (`005010X212`, kind `277S`). Payer Files lists them all with `PAYER_FILE_LABELS`.

## What each answer does

- **TA1**: an accepted interchange is recorded; a rejected one marks the 837P batch with that ISA13 control number rejected (`claim_batches.rejected_at`, `rejection`), sends each of its claims back to review like a 999 rejection ("The clearinghouse rejected the file envelope of 837P file N: reason"), and `Receive Payer File` opens a **Fix clearinghouse setup** task naming the reason, since an envelope problem is setup, not claim data.
- **271**: active or inactive coverage on the traced claim payer (an inactive coverage blocks billing that payer) and an eligibility event in the claim History. A Medicare answer (payer claim filing MA/MB) that names a Medicare Advantage plan (`EB*R` with HM, HN, PR or PS, plan from the 2120C `NM1*PRP/PR/P3` or EB05) becomes a review line: "Bill the Medicare Advantage plan instead: plan".
- **277 claim status**: a `claim_status` event per claim (category, code and text, and the payer claim number), shown in History and in the follow-up task.

## Eligibility and claim status requests

- `billing.check-eligibility` runs `Check Eligibility with Clearinghouse` (`billing.send-270`): real time when the connection has a real-time URL, applying the 271 at once as a payer file; otherwise, or when real time gets no answer, a batch `.ELG` upload (an answer that cannot be read is not re-sent in batch). Coverages already answered or with a request pending (`eligibility_requested_at`) are skipped, and an answer from another claim of the same patient, payer and member ID in the same month of service is copied instead of asking. It starts when Encounter to Claim saves a claim's payers and from **Check Eligibility** on a claim, which forces a new request; **Download 270** still builds the file for a biller.
- `Follow Up with Payer` first runs `Check Claim Status with Clearinghouse` (`billing.send-276`): real time, or, when real time gets no answer, a batch `.CLS` upload followed by a wait of up to a day for the claim to change, then shows the latest status in the follow-up task. Each request is recorded per run step in `claim_status_requests`, so a retried step returns what was already sent instead of paying for another 276.

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

`.dev/mock-clearinghouse.ts` follows these conventions (see [Mock clearinghouse](#mock-clearinghouse)), with a host key derived from a fixed seed so its fingerprint is always `MOCK_HOST_KEY`: `.CLP` claims, `.ELG` batch 270s and `.CLS` batch 276s in `/upload`, answers in `/download`, a `.TA1` for an interchange not addressed to Waystar, and `POST /core/realtime` answering 270 and 276. It remembers each claim it saw: a 276 is answered in process (A2) once accepted, paid (F1) once its 835 went out, rejected (A3) or not found (A4).

## Later

Insurance discovery, Waystar's own API adapter, separate real-time credentials and proprietary front-end rejection reports.

## Clearinghouse connection

Each agency can set its own clearinghouse connection in Settings (Clearinghouse Connection: Waystar, the mock or another SFTP clearinghouse, with SFTP account, pinned host key, folders, extensions and an optional CAQH CORE real-time URL). Its password is encrypted with `CLEARINGHOUSE_SECRET_KEY` (32 random bytes, base64; the api and worker both need it; rotate by moving the old key to `CLEARINGHOUSE_PREVIOUS_SECRET_KEYS`) and never sent back to the browser. A paused connection exchanges nothing. Agencies without one use the worker's `CLEARINGHOUSE_*` connection from `.env`, the dev default; leave `CLEARINGHOUSE_SFTP_HOST` empty for no default. Outside `NODE_ENV=development` the api refuses the mock, private or local hosts, and real-time URLs that are not https. Pointing at a real clearinghouse is a settings change:

| Setting                                | Mock (default)                        | TriZetto                               | Waystar                       |
| -------------------------------------- | ------------------------------------- | -------------------------------------- | ----------------------------- |
| `CLEARINGHOUSE_SFTP_HOST` / `_PORT`    | `localhost` / `2223`                  | from your TriZetto setup               | `sshftp.waystar.com` / `22`   |
| `CLEARINGHOUSE_SFTP_HOST_KEY`          | the mock's fixed `SHA256:VM15…`       | from TriZetto                          | from Waystar                  |
| `CLEARINGHOUSE_UPLOAD_PATH`            | `/upload`                             | the upload folder they give you        | `/upload` (write-only)        |
| `CLEARINGHOUSE_DOWNLOAD_PATHS`         | `/download`                           | one folder each for 999, 277CA and 835 | `/download`                   |
| `CLEARINGHOUSE_FILE_EXTENSION` (837P)  | `.CLP`                                | `.txt`                                 | `.CLP`                        |
| `CLEARINGHOUSE_ELIGIBILITY_EXTENSION`  | `.ELG`                                | `.txt`                                 | `.ELG`                        |
| `CLEARINGHOUSE_CLAIM_STATUS_EXTENSION` | `.CLS`                                | `.txt`                                 | `.CLS` (assumed; confirm)     |
| `CLEARINGHOUSE_AFTER_DOWNLOAD`         | `delete`                              | `delete`                               | `delete` or `keep`            |
| `CLEARINGHOUSE_REALTIME_URL`           | `http://localhost:2224/core/realtime` | empty (batch only)                     | from Waystar (not public yet) |

Response files are recognized by content (ISA/GS/ST, or a TA1 segment), not by name, and each agency's billing profile submitter ID must be the ID the clearinghouse addresses its responses to (its Receiver ID is `WAYSTAR` for Waystar). The worker polls every distinct connection once. Confirm folder names, extensions, IDs and real-time credentials with the clearinghouse during enrollment. See [.docs/clearinghouse.md](clearinghouse.md).

## Mock clearinghouse

`.dev/mock-clearinghouse.ts` is a dev-only, in-memory clearinghouse that follows Waystar's conventions, so moving to Waystar is a settings change. `pnpm dev` starts it (`pnpm dev:clearinghouse` alone): SFTP on `CLEARINGHOUSE_SFTP_HOST`:`CLEARINGHOUSE_SFTP_PORT` for `CLEARINGHOUSE_SFTP_USERNAME` / `CLEARINGHOUSE_SFTP_PASSWORD`, and CORE real-time eligibility and claim status on `CLEARINGHOUSE_REALTIME_PORT`. Files and claim states live in memory and are gone on restart. Its host key is derived from a fixed seed, so its fingerprint never changes: `MOCK_HOST_KEY` in `@ugula/billing`, which the mock preset and `.env.example` pin.

- Upload to the write-only `/upload` folder: 837P files as `<name>.CLP`, batch 270s as `<name>.ELG`, batch 276s as `<name>.CLS`, with no other periods in the name (`.part`, `.tmp` and `.filepart` uploads wait until renamed). About 2s later the file is picked up and removed.
- Answers arrive in `/download` as `<ISA06>_<type>_<yyyyMMddHHmmss>_<seq>.<ext>` and are recognized by content:
  - an interchange not addressed to `WAYSTAR` or `ZIRMED` (ISA08) gets a rejected `.TA1` and nothing else;
  - `.999` acknowledges the group (AK1 = the 837 GS06); an unreadable 837P gets a rejected 999 (`AK9*R`);
  - `.277` (277CA) has one status per claim (TRN = CLM01): accepted, or rejected with "Invalid member ID" when the subscriber member ID starts with `REJECT`;
  - `.835` follows after `CLEARINGHOUSE_REMIT_DELAY_SECONDS` (default 20) for accepted claims, one transaction per payer, 80% paid and the rest a CO-45, except payers listed in `CLEARINGHOUSE_ERA_UNENROLLED` (no ERA enrollment, so no 835);
  - `.271` answers each 270 inquiry: active coverage, inactive when the member ID starts with `INACTIVE`, naming a Medicare Advantage plan when it starts with `ADVANTAGE`, and reporting a hospital inpatient or SNF stay admitted on the date of service when it starts with `INPATIENT` or `SNF`;
  - `.277` (claim status, 005010X212) answers each 276: in process (A2) for an accepted claim, paid (F1) once its 835 went out, rejected (A3), or not found (A4) for a claim it never saw.
- `POST /core/realtime` takes a CAQH CORE multipart envelope (Basic auth, `PayloadType` `X12_270_Request_005010X279A1` or `X12_276_Request_005010X212`) and returns the 271 or 277 in the same envelope.

The answers come from `@ugula/billing/mock-waystar` (built on `@ugula/billing/mock`, which also has the 999/277CA/835/271/277 builders the e2e suites use).
