resource "mcma_service" "service" {
  depends_on = [
    aws_apigatewayv2_api.service_api,
    aws_apigatewayv2_integration.service_api,
    aws_apigatewayv2_route.service_api_default,
    aws_apigatewayv2_route.service_api_options,
    aws_apigatewayv2_stage.service_api,
    aws_dynamodb_table.service_table,
    aws_iam_role.api_handler,
    aws_iam_role_policy.api_handler,
    aws_lambda_function.api_handler,
    aws_lambda_permission.service_api_default,
    aws_lambda_permission.service_api_options,
  ]

  name      = var.name
  auth_type = local.service_auth_type
  job_type  = "AIJob"

  resource {
    resource_type = "JobAssignment"
    http_endpoint = "${local.service_url}/job-assignments"
  }

  job_profile_ids = [
    mcma_job_profile.celebrity_recognition.id,
    mcma_job_profile.face_detection.id,
    mcma_job_profile.content_moderation.id,
    mcma_job_profile.label_detection.id,
    mcma_job_profile.text_detection.id,
    mcma_job_profile.segment_detection.id,
    mcma_job_profile.transcription.id
  ]
}

resource "mcma_job_profile" "celebrity_recognition" {
  name = "AwsCelebrityRecognition"

  input_parameter {
    name = "inputFile"
    type = "Locator"
  }

  output_parameter {
    name = "outputFiles"
    type = "S3Locator[]"
  }
}

resource "mcma_job_profile" "face_detection" {
  name = "AwsFaceDetection"

  input_parameter {
    name = "inputFile"
    type = "Locator"
  }

  output_parameter {
    name = "outputFiles"
    type = "S3Locator[]"
  }
}

resource "mcma_job_profile" "content_moderation" {
  name = "AwsContentModeration"

  input_parameter {
    name = "inputFile"
    type = "Locator"
  }

  output_parameter {
    name = "outputFiles"
    type = "S3Locator[]"
  }
}

resource "mcma_job_profile" "label_detection" {
  name = "AwsLabelDetection"

  input_parameter {
    name = "inputFile"
    type = "Locator"
  }

  output_parameter {
    name = "outputFiles"
    type = "S3Locator[]"
  }
}

resource "mcma_job_profile" "text_detection" {
  name = "AwsTextDetection"

  input_parameter {
    name = "inputFile"
    type = "Locator"
  }

  output_parameter {
    name = "outputFiles"
    type = "S3Locator[]"
  }
}

resource "mcma_job_profile" "segment_detection" {
  name = "AwsSegmentDetection"

  input_parameter {
    name = "inputFile"
    type = "Locator"
  }

  output_parameter {
    name = "outputFiles"
    type = "S3Locator[]"
  }
}

resource "mcma_job_profile" "transcription" {
  name = "AwsTranscription"

  input_parameter {
    name = "inputFile"
    type = "Locator"
  }

  output_parameter {
    name = "outputFiles"
    type = "S3Locator[]"
  }
}
