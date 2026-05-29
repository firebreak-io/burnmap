# Bootstrap module: local state is intentional. This provisions one bucket + one
# role, applied once by an operator. Add a `backend "s3"` block here if the infra
# grows or is applied by more than one person on a shared AWS account.
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}
