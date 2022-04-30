#resource "mcma_service" "service" {
#  name      = var.name
#  auth_type = local.service_auth_type
#
#  resource {
#    resource_type = "JobAssignment"
#    http_endpoint = "${local.service_url}/job-assignments"
#  }
#
#  job_type        = "AIJob"
#  job_profile_ids = [
#    mcma_job_profile.celebrity_detection.id,
#  ]
#}
#
#resource "mcma_job_profile" "celebrity_detection" {
#  name = "AwsCelebrityRecognition"
#
#  input_parameter {
#    name = "inputFile"
#    type = "Locator"
#  }
#
#  output_parameter {
#    name = "outputFile"
#    type = "S3Locator"
#  }
#}
