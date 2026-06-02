# burnmap — Live Verification Runbook

End-to-end checks that can't be automated in CI (they need real AWS credentials,
a real PR, and Docker). Run these once to confirm burnmap works against live
GitHub + AWS. Nothing here was exercised by the unit/integration test suites.

> **Repo policy:** never run `tofu apply` without reviewing the plan first.

---

## 1. Provision the AWS infrastructure (S3 bucket + OIDC role)

burnmap needs three AWS resources. Create them with your own IaC (OpenTofu,
CloudFormation, CDK, etc.) — burnmap ships no infra module. Required:

- a **private** S3 bucket for the rendered PNGs — block all public access,
  `BucketOwnerEnforced` ownership, and a lifecycle rule expiring objects under
  `burnmap/` (e.g. after 30 days; reviewers reach them via presigned URLs).
- an IAM role assumable via **GitHub OIDC**
  (`token.actions.githubusercontent.com`), trust scoped to
  `repo:<owner>/<repo>:*`, granting `s3:PutObject` + `s3:GetObject` on
  `arn:aws:s3:::<bucket>/burnmap/*`. The action assumes this role to upload the
  image. (`GetObject` is required because the action can presign the GET URL as
  this same principal — without it the embedded image 403s.)
- *(optional, for durable image URLs)* an IAM **user** with a long-lived access
  key and `s3:GetObject` on `burnmap/*` only. Pass its key to the action's
  `presign-access-key-id` / `presign-secret-access-key` so the image URL is
  signed with static creds and stays valid for the full `url-ttl-seconds` (up
  to 7 days). Without it, the URL is signed by the OIDC role's *temporary*
  session creds and expires with the session (~1-12h) — if GitHub's Camo proxy
  hasn't cached the image by then, the comment shows "Error Fetching Resource".

You'll need the bucket name and the role ARN in step 5 (the real PR test).

> **If your IaC creates the presigner user's access key, treat its state as a
> secret** — the secret access key lands in state, not just CLI output. Use a
> remote encrypted backend (or keep local state gitignored and encrypted), and
> store the key itself as a GitHub Actions secret.

---

## 2. Build the Docker action locally (optional but recommended)

Confirms the root `Dockerfile` builds the whole workspace and the entrypoint
resolves. The build context must be the repo root:

```bash
docker build -t burnmap-action .
```

A successful build ends with the `mcr.microsoft.com/playwright` base image
containing `node /burnmap/packages/action/dist/main.js` as the entrypoint.

---

## 3. Smoke-test the renderer locally (no AWS, no GitHub)

Produces a real PNG from a plan file using the shoot CLI — a fast confidence
check that parse → render → screenshot works on your machine:

```bash
npm install
npm run build --workspaces --if-present # build parser + web + shoot dist (the CLI needs all three)
npx playwright install chromium         # one-time

# Use any `tofu show -json` output, or a fixture:
node packages/shoot/dist/cli.js \
  packages/parser/test/fixtures/replace-db.json \
  --out /tmp/burnmap-smoke.png --repo demo/demo --pr 1 --sha abc123
open /tmp/burnmap-smoke.png            # macOS; use xdg-open on Linux
```

---

## 4. Tag a release so consumers can pin the action

Docker actions are referenced by ref; consumers use `firebreak-io/burnmap@v1`:

```bash
git tag -a v1 -m "burnmap v1" <main-sha>
git push origin v1
# (Optionally publish a GitHub Release from the tag.)
```

Until then, consumers can reference `@main` or a commit SHA.

---

## 5. Real PR test (the actual end-to-end)

In a Terraform/OpenTofu repo (could be a throwaway one, or burnmap itself with a
tiny sample config):

1. Add `.github/workflows/burnmap.yml` from `docs/example-consumer-workflow.yml`,
   filling in `<ACCOUNT_ID>`, the `uploader_role_arn`, and the `bucket_name`.
2. Open a PR that changes some Terraform.
3. **Confirm:** a single burnmap comment appears with the embedded diagram
   (summary pills, danger index, grouped manifest).
4. Push another commit to the PR.
5. **Confirm:** the *same* comment updates in place (no duplicate), and the
   image reflects the new plan.

### What to watch for
- **Image renders in the comment** — GitHub's Camo proxy fetches the presigned
  URL once and caches it, so it keeps displaying after the URL's TTL expires.
- **No `AccessDenied` on the image** — requires `s3:GetObject` on the uploader
  role (already in the infra).
- **Sticky, not spammy** — the comment is keyed by `<!-- burnmap:pr-N -->` on its
  first line and edited in place; a fresh comment per push means the marker match
  or update step failed (check the action logs).
- **No secret values** — the parser redacts sensitive attributes to `«sensitive»`
  before rendering; verify none leak into the diagram or the `<details>` fallback.

---

## Known follow-ups (tracked / deferred)
- **CodeQL / GHAS**: the `main` ruleset requires a CodeQL code-scanning result,
  but GitHub Advanced Security is disabled on this private repo, so the gate is
  bypassed by org-admin on merge. To satisfy it legitimately, enable GHAS and
  re-add the CodeQL workflow (recoverable from `feat/parser` history at
  `7bbacc0`).
- **Centralize `HIGH_RISK_THRESHOLD`** in `@burnmap/parser` (currently duplicated
  in web `model-view.ts` and action `comment.ts`) — FBK Todoist `6gm25r7Pv6M8JjQH`.
