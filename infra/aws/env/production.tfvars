environment         = "production"
api_domain          = "api.siumora.com"
storefront_url      = "https://siumora.com"
extra_store_origins = ["https://www.siumora.com"]
# Replace with the real staff list before the first apply (one email:owner minimum).
admin_user_roles = "owner@siumora.com:owner"
# Filled from the founder track (plan 18 F1/F2/F7). gstin stays empty until issued;
# invoices refuse to print until it is set.
seller = {
  name       = ""
  address    = ""
  gstin      = ""
  state_code = "27"
  email      = ""
  phone      = ""
}
db_instance_class = "db.t4g.medium"
db_multi_az       = true
redis_replicas    = 1
server_count      = 2
# The staging apply created the account-wide GitHub OIDC provider.
create_github_oidc_provider = false

# Alarms go here; confirm the subscription email AWS sends once.
alert_email = ""
# Optional custom image host (needs a CNAME + certificate records, see outputs).
images_domain = ""
