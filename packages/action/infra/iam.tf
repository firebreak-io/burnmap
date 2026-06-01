data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]
    effect  = "Allow"
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repo}:*"]
    }
  }
}

resource "aws_iam_role" "uploader" {
  name               = "burnmap-uploader"
  assume_role_policy = data.aws_iam_policy_document.trust.json
}

data "aws_iam_policy_document" "put_shots" {
  statement {
    # PutObject to upload the rendered PNG. GetObject because the action presigns
    # a GET URL signed by THIS role — S3 authorizes the presigned request as the
    # signing principal, so without GetObject the embedded image URL 403s.
    actions   = ["s3:PutObject", "s3:GetObject"]
    effect    = "Allow"
    resources = ["${aws_s3_bucket.shots.arn}/burnmap/*"]
  }
}

resource "aws_iam_role_policy" "put_shots" {
  name   = "burnmap-put-shots"
  role   = aws_iam_role.uploader.id
  policy = data.aws_iam_policy_document.put_shots.json
}

# Long-lived IAM user used ONLY to presign image GET URLs. The uploader role's
# OIDC session creds are temporary, so URLs they sign expire with the session
# (~1-12h) — often before GitHub's Camo proxy caches the image. Static user
# credentials lift the presigned-URL lifetime to the S3 SigV4 max of 7 days.
# Scoped to GetObject on burnmap/* only; it cannot upload.
resource "aws_iam_user" "presigner" {
  name = "burnmap-presigner"
}

data "aws_iam_policy_document" "get_shots" {
  statement {
    actions   = ["s3:GetObject"]
    effect    = "Allow"
    resources = ["${aws_s3_bucket.shots.arn}/burnmap/*"]
  }
}

resource "aws_iam_user_policy" "get_shots" {
  name   = "burnmap-get-shots"
  user   = aws_iam_user.presigner.name
  policy = data.aws_iam_policy_document.get_shots.json
}

resource "aws_iam_access_key" "presigner" {
  user = aws_iam_user.presigner.name
}
