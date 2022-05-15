############
# SNS Topic
############

resource "aws_sns_topic" "service" {
  name = format("%.256s", var.prefix)
}

############
# Invoke lambda SNS handler
############

resource "aws_lambda_permission" "service" {
  statement_id  = "AllowExecutionFromSNS"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sns_handler.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.service.arn
}

resource "aws_sns_topic_subscription" "service" {
  topic_arn = aws_sns_topic.service.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.sns_handler.arn
}

##############
# Allow Rekognition to invoke SNS
##############

resource "aws_iam_role" "rekognition" {
  name = format("%.64s", replace("${var.prefix}-${var.aws_region}-rekognition", "/[^a-zA-Z0-9_]+/", "-" ))
  path = var.iam_role_path

  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRole"
        Principal = {
          Service = "rekognition.amazonaws.com"
        }
        Effect = "Allow"
      }
    ]
  })
}

resource "aws_iam_role_policy" "rekognition" {
  name = aws_iam_role.rekognition.name
  role = aws_iam_role.rekognition.id

  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [
      {
        Sid      = "AllowSnsPublish"
        Effect   = "Allow"
        Action   = "sns:Publish"
        Resource = aws_sns_topic.service.arn
      }
    ]
  })
}
