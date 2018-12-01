terraform {
  backend "s3" {
    bucket = "ops-config-mgmt"
    region = "us-east-1"
    key    = "terraform-state/terraform-aws-cloudfront-invalidation/terraform.tfstate"
  }
}

module "cloudfront_invalidation" {
  source = "github.com/dirt-simple/terraform-aws-cloudfront-invalidation"
}
