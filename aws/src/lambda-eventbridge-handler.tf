##############################
# Lambda eventbridge-handler
##############################

locals {
  lambda_name_eventbridge_handler = format("%.64s", replace("${var.prefix}-eventbridge-handler", "/[^a-zA-Z0-9_]+/", "-" ))
  eventbridge_handler_zip_file    = "${path.module}/lambdas/eventbridge-handler.zip"
}

resource "aws_iam_role" "eventbridge_handler" {
  name = format("%.64s", replace("${var.prefix}-${var.aws_region}-eventbridge-handler", "/[^a-zA-Z0-9_]+/", "-" ))
  path = var.iam_role_path

  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowLambdaAssumingRole"
        Effect    = "Allow"
        Action    = "sts:AssumeRole",
        Principal = {
          "Service" = "lambda.amazonaws.com"
        }
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "eventbridge_handler" {
  name = aws_iam_role.eventbridge_handler.name
  role = aws_iam_role.eventbridge_handler.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = concat([
      {
        Sid      = "DescribeCloudWatchLogs"
        Effect   = "Allow"
        Action   = "logs:DescribeLogGroups"
        Resource = "*"
      },
      {
        Sid    = "WriteToCloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ]
        Resource = concat([
          "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:${var.log_group.name}:*",
          "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda/${local.lambda_name_eventbridge_handler}:*",
        ], var.enhanced_monitoring_enabled ? [
          "arn:aws:logs:${var.aws_region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/lambda-insights:*",
        ] : [])
      },
      {
        Sid    = "ListAndDescribeDynamoDBTables"
        Effect = "Allow"
        Action = [
          "dynamodb:List*",
          "dynamodb:DescribeReservedCapacity*",
          "dynamodb:DescribeLimits",
          "dynamodb:DescribeTimeToLive",
        ]
        Resource = "*"
      },
      {
        Sid    = "AllowTableOperations"
        Effect = "Allow"
        Action = [
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:DeleteItem",
          "dynamodb:DescribeTable",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:UpdateItem",
        ]
        Resource = aws_dynamodb_table.service_table.arn
      },
      {
        Sid      = "AllowInvokingWorkerLambda"
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.worker.arn
      },
    ],
      var.xray_tracing_enabled ?
      [
        {
          Sid    = "AllowLambdaWritingToXRay"
          Effect = "Allow"
          Action = [
            "xray:PutTraceSegments",
            "xray:PutTelemetryRecords",
            "xray:GetSamplingRules",
            "xray:GetSamplingTargets",
            "xray:GetSamplingStatisticSummaries",
          ]
          Resource = "*"
        }
      ] : [],
      var.dead_letter_config_target != null ?
      [
        {
          Sid      = "AllowLambdaToSendToDLQ"
          Effect   = "Allow"
          Action   = "sqs:SendMessage"
          Resource = var.dead_letter_config_target
        }
      ] : [])
  })
}

resource "aws_lambda_function" "eventbridge_handler" {
  depends_on = [
    aws_iam_role_policy.eventbridge_handler
  ]

  function_name    = local.lambda_name_eventbridge_handler
  role             = aws_iam_role.eventbridge_handler.arn
  handler          = "index.handler"
  filename         = local.eventbridge_handler_zip_file
  source_code_hash = filebase64sha256(local.eventbridge_handler_zip_file)
  runtime          = "nodejs14.x"
  timeout          = "30"
  memory_size      = "2048"

  layers = var.enhanced_monitoring_enabled ? ["arn:aws:lambda:${var.aws_region}:580247275435:layer:LambdaInsightsExtension:14"] : []

  environment {
    variables = {
      LogGroupName     = var.log_group.name
      TableName        = aws_dynamodb_table.service_table.name
      PublicUrl        = local.service_url
      WorkerFunctionId = aws_lambda_function.worker.function_name
      Prefix           = var.prefix
    }
  }

  dynamic "dead_letter_config" {
    for_each = var.dead_letter_config_target != null ? toset([1]) : toset([])

    content {
      target_arn = var.dead_letter_config_target
    }
  }

  tracing_config {
    mode = var.xray_tracing_enabled ? "Active" : "PassThrough"
  }

  tags = var.tags
}

resource "aws_cloudwatch_event_rule" "eventbridge_handler" {
  name          = var.prefix
  event_pattern = jsonencode({
    source      = ["aws.transcribe"]
    detail-type = ["Transcribe Job State Change"]
    detail      = {
      TranscriptionJobStatus = [
        "COMPLETED",
        "FAILED"
      ]
    }
  })

  tags = var.tags
}

resource "aws_cloudwatch_event_target" "eventbridge_handler" {
  arn  = aws_lambda_function.eventbridge_handler.arn
  rule = aws_cloudwatch_event_rule.eventbridge_handler.name
}

resource "aws_lambda_permission" "eventbridge_handler" {
  statement_id  = "AllowInvocationFromEventbridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.eventbridge_handler.arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.eventbridge_handler.arn
}
