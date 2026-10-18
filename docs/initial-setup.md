# Initial application setup

After creation, sign in as administrator and open **الإعداد الأولي** (`/admin/setup`). Only users with `manage all` can access the page and its actions. Resume later without losing recorded results.

1. Review and explicitly approve the installed company identity. Complete project-owned `docs/design-identity.md`, `company-identity.json`, `inertia/brand.ts` and brand assets if provisional. Checklist approval does not rewrite branding. Calendar/dialog preferences remain under settings.
2. Send an internal test notification, open the inbox, mark it read and return. Evidence belongs to the signed-in administrator.
3. Configure SMTP, restart web/worker processes, then select **إرسال بريد تجريبي**. The recipient is the administrator's stored email, never a request-supplied address. Compare the attempt reference in the email before selecting **وصلت الرسالة**; otherwise select **لم تصل الرسالة**. Reopen the dialog later if needed. Pending confirmations expire after 24 hours. Configuration changes invalidate old evidence. SMTP acceptance alone stays pending.
4. Run the storage check: write a unique private test file, read/compare its content, then delete that file. Business attachments are untouched. Preserve local volumes or configure S3. Changing disks does not move existing files; use the documented storage migration flow.
5. Check PostgreSQL/Redis connectivity. Run `node ace adula:worker` continuously and exactly one `node ace scheduler:run` under the deployment process manager. Review fresh heartbeats and failed jobs in **تشغيل النظام**. Connectivity does not prove job execution.
6. Configure offsite backup storage and the supplied backup service. Run `node ace backup:verify` to inspect snapshot objects. Download an offsite snapshot and use `backup:restore-test` to verify a restored record and attachment in an isolated temporary database. Local snapshots do not establish offsite acceptance.
7. Google/GitHub sign-in is optional and does not block the base release ([ADR 021](decisions/021-optional-oauth.md)); the owner declined it for the current setup. Leave credentials empty unless requested. When enabled, configure the provider and callback URLs. Try real sign-in in another session while retaining administrator access. Configuration alone never counts as verified login.

## Environment configuration

| Service | Variables                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Mail    | `MAIL_FROM_NAME`, `MAIL_FROM_ADDRESS`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`                                           |
| TLS     | `SMTP_SECURE` for implicit TLS; `SMTP_REQUIRE_TLS` for STARTTLS. Without overrides, port 465 uses implicit TLS and production requires TLS. |
| File S3 | `DRIVE_DISK=s3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `S3_BUCKET`, optional `AWS_ENDPOINT`                           |
| Backups | `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_REGION`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`                      |
| OAuth   | `APP_URL`, plus `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` or `MICROSOFT_CLIENT_ID`/`MICROSOFT_CLIENT_SECRET`/`MICROSOFT_TENANT_ID` ([authentication.md](authentication.md))                                      |

Verify the sender/domain with the mail provider. Keep secrets out of Git and generic JSON settings. Restart affected processes after environment changes and repeat the relevant test. Never disable certificate verification to make a test pass.

S3 uses `supportsACL: false` with private visibility so uploads work with bucket-owner-enforced buckets and S3-compatible providers that disable ACLs. Keep public access blocked and scope IAM access to the intended bucket. This option belongs in `config/drive.ts`, not `.env`; it does not grant bucket permissions. After changing the configuration, restart the application and run the storage roundtrip check. A successful local-disk check does not validate S3.

## Adding users

Fresh projects include **إضافة مستخدم** in user administration and **دعوة مستخدم** in navigation. Administrators may delegate only **دعوات المستخدمين → دعوة مستخدم** through the roles matrix and a deployment-wide role assignment. This permission does not expose the administrative user list or grant role-assignment authority.

Configure SMTP and `APP_URL` before sending invitations. Enter the user's name and email; the message contains a single-use link valid for 24 hours. The account is created only when the recipient chooses a password. The administrator then assigns business roles and organizational membership. To resend an unaccepted invitation, enter the same email after one minute; the earlier link is invalidated. Delivery failure is shown inside the dialog and can be retried. Existing accounts are managed from the users screen, never replaced by an invitation.

## Evidence limits

Protected `setup.*` settings hold setup evidence; `mail.delivery_test` holds per-administrator mail attempts. PostgreSQL tests cover races, stale confirmations, failures and evidence tampering. The loopback SMTP sink exercises a real SMTP conversation but proves no external inbox delivery. Production acceptance requires real infrastructure and administrator receipt confirmation.
