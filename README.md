# burnmap

Render an OpenTofu/Terraform plan as a styled diagram and post it as a sticky
comment on the pull request — so reviewers see *what will change* at a glance
instead of scrolling raw `terraform plan` output.

burnmap is a Docker-based GitHub Action. On every PR it turns
`tofu show -json <plan>` into a visual summary (create / update / replace /
destroy, a "danger index", and a grouped manifest of resources), uploads the
rendered image to a private S3 bucket, and upserts a single PR comment that
embeds it. Sensitive attribute values are redacted to `«sensitive»` before
rendering.

## How it works

```
tofu plan -json ──▶ @burnmap/parser ──▶ ChangeModel
                                          │
                    @burnmap/web (React SPA, renders the model)
                                          │
                    @burnmap/shoot (headless Chromium screenshot) ──▶ PNG
                                          │
                    @burnmap/action ──▶ upload to S3 ──▶ presigned URL
                                          │
                              sticky PR comment (embeds the image)
```

GitHub's Camo proxy fetches the presigned URL once at render time and caches the
bytes, so the image keeps displaying after the URL's TTL expires.

## Usage

Add a workflow to your Terraform/OpenTofu repo (full version with comments:
[`docs/example-consumer-workflow.yml`](docs/example-consumer-workflow.yml)):

```yaml
name: tofu plan + burnmap
on: pull_request

permissions:
  contents: read
  pull-requests: write   # post / update the sticky comment
  id-token: write        # mint the OIDC token to assume the AWS upload role

jobs:
  burnmap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: opentofu/setup-opentofu@v1

      - name: Assume the burnmap uploader role (OIDC)
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::<ACCOUNT_ID>:role/<your-uploader-role>
          aws-region: us-west-2

      - name: Generate the plan JSON
        run: |
          tofu init -input=false
          tofu plan -out=tfplan -input=false
          tofu show -json tfplan > plan.json

      - name: Render plan as a PR comment
        uses: firebreak-io/burnmap@v1
        with:
          plan-json: plan.json
          s3-bucket: <your-private-bucket>
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `plan-json` | yes | — | Path to `tofu show -json <plan>` output. |
| `s3-bucket` | yes | — | Private S3 bucket for the rendered PNG. |
| `aws-region` | no | `us-west-2` | Region of the bucket. Must match where the bucket lives, or presigning fails. |
| `url-ttl-seconds` | no | `86400` | Presigned-URL TTL. `1`–`604800` (S3 SigV4 max is 7 days). |
| `github-token` | no | `${{ github.token }}` | Token for posting the comment (needs `pull-requests: write`). |
| `web-dist` | no | bundled | Override the built SPA (rarely needed). |
| `presign-access-key-id` | no | — | Long-lived IAM key id used **only** to presign the GET URL for durable images. Set with the secret below. |
| `presign-secret-access-key` | no | — | Secret paired with `presign-access-key-id`. |

**Output:** `image-url` — the presigned URL of the uploaded diagram.

## Multiple plans, upload-only, and captions

`plan-json` accepts a single path **or** a glob (expanded inside the action):

    plan-json: 'plans/**/*.json'

Each resolved plan renders and uploads independently. Outputs:

- `image-url` — the first URL (lexicographic order).
- `image-urls` — a JSON array of all URLs in stable order. Parse with
  `fromJSON()` in a workflow.

Set `comment: false` for upload-only mode — burnmap uploads and returns
`image-urls` without touching the PR (no `pull-requests: write` or `github-token`
needed). Use this when your workflow composes its own comment from `image-urls`.

Add a caption strip to each PNG with `labels-from` (`none` default, `filename`,
`path-parent`, `relative-path`) or explicit `labels` (a JSON object keyed by the
plan path relative to the working directory, which overrides `labels-from`):

    labels-from: path-parent

    labels: |
      { "plans/ec-dev/network/plan.json": "ec-dev / network" }

## Architecture diagrams

Set `mode` to render an architecture diagram of the stack instead of (or alongside) the plan diff:

- `plan` (default) renders the change-diff diagram. Unchanged behavior.
- `arch` renders a clustered diagram of the stack's resources and their references, derived from the plan's `configuration` section. It posts as a separate sticky comment; the URL is exposed as the `arch-image-url` output.
- `both` renders both, and tints changed resources on the architecture.

In `arch` (and `both`) mode, `image-urls` contains the architecture diagram URLs. In a multi-plan `both` run, only the first architecture URL is exposed via `arch-image-url` — the rest are embedded in the architecture comment.

Phase 1 scope: resources within one stack, with edges resolved inside a module scope (cross-module edges and data sources are not drawn yet). Generate diagrams locally with the CLI:

    burnmap-graph plan.json --out arch.svg     # scalable, docs-friendly
    burnmap-graph plan.json --out arch.png     # raster (needs Chromium)

### Durable image URLs

By default the image URL is signed with the OIDC role's *temporary* session
credentials, so it expires with the session (~1–12h). If Camo hasn't cached the
image by then, the comment shows "Error Fetching Resource". To keep URLs valid
for the full TTL, presign with a long-lived IAM user
(`presign-access-key-id` / `presign-secret-access-key`) and pair it with
`url-ttl-seconds: "604800"` for a 7-day window.

## AWS setup

burnmap ships no infrastructure module — provision these with your own IaC:

1. a **private** S3 bucket (all public access blocked) with a lifecycle rule
   expiring objects under `burnmap/`,
2. a **GitHub-OIDC** IAM role with `s3:PutObject` + `s3:GetObject` on
   `<bucket>/burnmap/*`, trust scoped to `repo:<owner>/<repo>:*`,
3. *(optional)* a long-lived IAM user with `s3:GetObject` for durable URLs.

See [`docs/live-verification.md`](docs/live-verification.md) for the exact
resource definitions and an end-to-end verification runbook.

## Development

This is an npm-workspaces monorepo (Node 22):

| Package | Responsibility |
|---|---|
| `@burnmap/parser` | `tofu show -json` → `ChangeModel` (with redaction) |
| `@burnmap/web` | React + Vite SPA that renders a `ChangeModel` |
| `@burnmap/shoot` | headless-Chromium screenshot of the SPA |
| `@burnmap/action` | the GitHub Action: S3 upload + sticky PR comment |

```bash
npm install
npm run build --workspaces --if-present
npm test --workspaces --if-present      # Vitest
npx playwright install chromium         # one-time, for @burnmap/shoot
```

## License

[MIT](LICENSE)
