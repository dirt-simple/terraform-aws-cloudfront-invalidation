variable "aws_region" {
  type        = string
  description = "The AWS region"
  default     = "us-east-1"
}

variable "name" {
  type        = string
  description = "This will be the name/prefix of all resources created"
  default     = "cloudfront-invalidation"
}

variable "lambda_concurrent_executions" {
  type        = string
  description = "Max concurrent invalidation lambdas."
  default     = "1"
}

variable "lambda_timeout" {
  description = "Lambda timeout"
  default     = "3"
}

variable "lambda_runtime" {
  description = "Lambda runtime. Default is nodejs12.x"
  default     = "nodejs12.x"
}

variable "lambda_memory_size" {
  default = "128"
}

variable "invalidation_max_retries" {
  type        = string
  description = "How may times to try to invalidate a path."
  default     = "20"
}

variable "invalidation_retry_timeout" {
  type        = string
  description = "How long to wait between retries. Max is 900"
  default     = "300"
}

variable "sqs_message_retention_seconds" {
  type    = string
  default = "86400"
}

variable "sqs_receive_wait_time_seconds" {
  type    = string
  default = "10"
}

// sqs visibility_timeout_seconds must be >= lambda fn timeout, aws reccomends at least 6 times the lambda
// https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html#events-sqs-queueconfig
variable "sqs_visibility_timeout_multiplier" {
  default = 6
}


variable "sqs_batch_size" {
  type        = string
  description = "10 is the max for SQS"
  default     = "10"
}

variable "log_retention_in_days" {
  type        = string
  description = "the number of days you want to retain log events in the specified log group."
  default     = "3"
}

variable "tags" {
  type        = map(object({}))
  description = "A mapping of tags to assign to the resource"
  default     = {}
}

locals {
  tags = merge(var.tags, map("terraform-module", "github.com/dirt-simple/tf/infrastructure/cloudfront/invalidation"))
}

provider "aws" {
  region = var.aws_region
}

# Reusable policy document
data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect = "Allow"

    actions = [
      "sts:AssumeRole",
    ]

    principals {
      type = "Service"

      identifiers = [
        "lambda.amazonaws.com",
      ]
    }
  }
}

data "archive_file" "sqs_lambda" {
  type        = "zip"
  source_file = "${path.module}/lambda/index.js"
  output_path = "${path.module}/lambda_function.zip"
}

resource "aws_lambda_function" "sqs_lambda" {
  filename                       = "${path.module}/lambda_function.zip"
  function_name                  = var.name
  role                           = aws_iam_role.sqs_lambda.arn
  handler                        = "index.handler"
  source_code_hash               = data.archive_file.sqs_lambda.output_base64sha256
  runtime                        = var.lambda_runtime
  reserved_concurrent_executions = var.lambda_concurrent_executions
  timeout                        = var.lambda_timeout
  memory_size                    = var.lambda_memory_size
  environment {
    variables = {
      INVALIDATION_MAX_RETRIES  = var.invalidation_max_retries
      INVALIDATION_RETRY_TIMOUT = var.invalidation_retry_timeout
    }
  }

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "sqs_lambda" {
  name              = "/aws/lambda/${var.name}"
  retention_in_days = var.log_retention_in_days
  tags              = local.tags
}

resource "aws_iam_role" "sqs_lambda" {
  name               = var.name
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
  tags               = local.tags
}

data "aws_iam_policy_document" "sqs_lambda" {
  statement {
    effect = "Allow"

    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]

    resources = [
      "arn:aws:logs:*:*:*",
    ]
  }

  statement {
    effect = "Allow"

    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:SendMessage",
      "sqs:GetQueueUrl",
      "sqs:GetQueueAttributes",
      "sqs:ChangeMessageVisibility",
    ]

    resources = [
      aws_sqs_queue.sqs_queue.arn,
    ]
  }

  statement {
    effect = "Allow"

    actions = [
      "sqs:ListQueues",
    ]

    resources = [
      "*",
    ]
  }

  statement {
    effect = "Allow"

    actions = [
      "cloudfront:CreateInvalidation",
    ]

    resources = [
      "*",
    ]
  }
}

resource "aws_iam_role_policy" "sqs_lambda" {
  name   = "generated-policy"
  role   = aws_iam_role.sqs_lambda.name
  policy = data.aws_iam_policy_document.sqs_lambda.json
}

resource "aws_sns_topic" "sns_topic" {
  name = var.name
}

resource "aws_sqs_queue" "sqs_queue" {
  name                       = var.name
  message_retention_seconds  = var.sqs_message_retention_seconds
  receive_wait_time_seconds  = var.sqs_receive_wait_time_seconds
  visibility_timeout_seconds = var.lambda_timeout * var.sqs_visibility_timeout_multiplier
  tags                       = local.tags
}

resource "aws_sns_topic_subscription" "sqs_subscribe" {
  topic_arn = aws_sns_topic.sns_topic.arn
  endpoint  = aws_sqs_queue.sqs_queue.arn
  protocol  = "sqs"
}

resource "aws_lambda_event_source_mapping" "sqs_worker" {
  enabled          = true
  batch_size       = var.sqs_batch_size
  event_source_arn = aws_sqs_queue.sqs_queue.arn
  function_name    = aws_lambda_function.sqs_lambda.arn
}

resource "aws_sqs_queue_policy" "sqs_queue" {
  queue_url = aws_sqs_queue.sqs_queue.id
  policy    = data.aws_iam_policy_document.sqs_queue.json
}

data "aws_iam_policy_document" "sqs_queue" {
  policy_id = "generated-policy"

  statement {
    actions = [
      "sqs:SendMessage",
    ]

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"

      values = [
        aws_sns_topic.sns_topic.arn,
        aws_lambda_function.sqs_lambda.arn,
      ]
    }

    effect = "Allow"

    principals {
      type = "AWS"

      identifiers = [
        "*",
      ]
    }

    resources = [
      aws_sqs_queue.sqs_queue.arn,
    ]
  }
}

output "sns-topic-arn" {
  value = aws_sns_topic.sns_topic.arn
}

output "sns-topic-id" {
  value = aws_sns_topic.sns_topic.id
}
