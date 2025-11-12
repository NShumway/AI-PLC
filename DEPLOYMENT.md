# Deployment Guide - AWS with CI/CD

This guide walks through deploying the AI-Powered PLC Coach to AWS with automated CI/CD using GitHub Actions.

## ✅ Your Infrastructure (Already Created)

### Backend
- **App Runner Service**: `plc-coach-backend`
- **Service URL**: `https://pcmgk7gxxw.us-east-2.awsapprunner.com`
- **Service ARN**: `arn:aws:apprunner:us-east-2:971422717446:service/plc-coach-backend/9a6e0dc55e2d43d6bb33dd20eacbd8d1`
- **ECR Repository**: `971422717446.dkr.ecr.us-east-2.amazonaws.com/plc-coach-backend`

### Frontend
- **S3 Bucket**: `plc-coach-frontend`
- **CloudFront URL**: `https://dbfht5xx741j1.cloudfront.net`
- **CloudFront Distribution ID**: `E1UKY0K0UI0L2A`

### Database
- **RDS PostgreSQL**: `plc-coach-db.c1uuigcm4bd1.us-east-2.rds.amazonaws.com`
- **Database Name**: `plccoach`

### IAM & Networking
- **GitHub Actions Role ARN**: `arn:aws:iam::971422717446:role/GitHubActionsDeployRole`
- **VPC Connector**: `plc-coach-vpc-connector`

## 🔑 Required GitHub Secrets

Add these at: https://github.com/NShumway/AI-PLC/settings/secrets/actions

```
AWS_ROLE_ARN
arn:aws:iam::971422717446:role/GitHubActionsDeployRole

APP_RUNNER_SERVICE_ARN
arn:aws:apprunner:us-east-2:971422717446:service/plc-coach-backend/9a6e0dc55e2d43d6bb33dd20eacbd8d1

BACKEND_API_URL
https://pcmgk7gxxw.us-east-2.awsapprunner.com

CLOUDFRONT_DISTRIBUTION_ID
E1UKY0K0UI0L2A
```

## 🔧 Update Google OAuth

Add to Google Cloud Console OAuth credentials:
- **Redirect URI**: `https://pcmgk7gxxw.us-east-2.awsapprunner.com/auth/google/callback`
- **Authorized Origins**:
  - `https://dbfht5xx741j1.cloudfront.net`
  - `https://pcmgk7gxxw.us-east-2.awsapprunner.com`

## 🚀 Quick Start - Deploy Now

All infrastructure is ready! Complete these 3 steps to deploy:

### Step 1: Add GitHub Secrets

Go to https://github.com/NShumway/AI-PLC/settings/secrets/actions and add the 4 secrets listed above.

### Step 2: Update Google OAuth

Add the redirect URIs and authorized origins listed above to your Google Cloud Console OAuth credentials.

### Step 3: Push to Deploy

```bash
git add .
git commit -m "Deploy to AWS"
git push origin master
```

GitHub Actions will automatically:
1. ✅ Build and push Docker image to ECR
2. ✅ Deploy backend to App Runner
3. ✅ Build frontend with production API URL
4. ✅ Deploy frontend to S3
5. ✅ Invalidate CloudFront cache

Your app will be live at: **https://dbfht5xx741j1.cloudfront.net**

## 📊 Monitoring & Management

### Check Deployment Status
- **App Runner**: AWS Console → App Runner → plc-coach-backend → Logs
- **CloudFront**: Check `https://dbfht5xx741j1.cloudfront.net` (takes 15-20 min to deploy)
- **Backend Health**: `https://pcmgk7gxxw.us-east-2.awsapprunner.com/health`

### Run Database Migration (If Needed)

Connect to production database and run migration:

```bash
# Get password from Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id rds!db-bf89f9fc-3d72-4b80-a2a1-96b5b4584ecc \
  --query SecretString \
  --output text

# Connect to RDS
psql -h plc-coach-db.c1uuigcm4bd1.us-east-2.rds.amazonaws.com \
     -U postgres \
     -d plccoach

# Run migration
\i backend/migrations/001_initial_schema.sql
```

### Test Production Deployment

1. Visit CloudFront URL: `https://dbfht5xx741j1.cloudfront.net`
2. Test Google login
3. Test chat functionality
4. Check App Runner logs in AWS console

## Troubleshooting

### Backend won't start
- Check App Runner logs
- Verify environment variables from Secrets Manager
- Ensure VPC connector can reach RDS
- Check RDS security group allows App Runner

### Frontend can't reach backend
- Verify CORS settings in backend
- Check BACKEND_API_URL in frontend build
- Verify App Runner health check passes

### Database connection fails
- Verify RDS security group allows VPC connector
- Check DATABASE_URL is constructed correctly
- Verify pgvector extension is installed

## Security Checklist

- [ ] RDS is not publicly accessible
- [ ] RDS security group only allows VPC connector
- [ ] All secrets in AWS Secrets Manager
- [ ] HTTPS enforced on CloudFront
- [ ] GitHub Actions uses OIDC (no long-lived credentials)
- [ ] IAM roles follow least privilege

## Next Steps

- Set up custom domain with Route 53
- Configure CloudWatch alerts
- Set up AWS Budget alerts
- Enable AWS WAF on CloudFront
- Configure backup retention policies

---

# Setup From Scratch (For New Deployments)

If you're deploying this to your own AWS account, follow these steps:

## Prerequisites

- AWS Account with billing enabled
- AWS CLI installed and configured (`aws configure`)
- Docker installed
- Node.js 18+ installed
- GitHub repository
- Google OAuth credentials (Client ID + Secret)
- OpenAI API key

## Step 1: Create RDS PostgreSQL Database

```bash
# This will prompt you to set a master password - save it!
aws rds create-db-instance \
  --db-instance-identifier plc-coach-db \
  --db-instance-class db.t3.medium \
  --engine postgres \
  --engine-version 15.4 \
  --master-username postgres \
  --master-user-password YOUR_SECURE_PASSWORD \
  --allocated-storage 50 \
  --storage-type gp3 \
  --vpc-security-group-ids YOUR_SECURITY_GROUP_ID \
  --db-name plccoach \
  --backup-retention-period 7 \
  --publicly-accessible \
  --region us-east-2

# Wait 10-15 minutes for database to be available
aws rds wait db-instance-available --db-instance-identifier plc-coach-db --region us-east-2

# Get the endpoint
aws rds describe-db-instances \
  --db-instance-identifier plc-coach-db \
  --region us-east-2 \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text
```

## Step 2: Install pgvector Extension

```bash
# Connect to your database (use password from Step 1)
psql -h YOUR_RDS_ENDPOINT -U postgres -d plccoach

# Install extension
CREATE EXTENSION vector;
\q
```

## Step 3: Secure Database (Make it Private)

```bash
# Modify to make not publicly accessible
aws rds modify-db-instance \
  --db-instance-identifier plc-coach-db \
  --no-publicly-accessible \
  --apply-immediately \
  --region us-east-2
```

## Step 4: Create Secrets in AWS Secrets Manager

```bash
# Store RDS credentials
aws secretsmanager create-secret \
  --name plc-coach/rds-credentials \
  --description "RDS PostgreSQL credentials" \
  --secret-string '{
    "username":"postgres",
    "password":"YOUR_SECURE_PASSWORD",
    "host":"YOUR_RDS_ENDPOINT"
  }' \
  --region us-east-2

# Store application config
aws secretsmanager create-secret \
  --name plc-coach/app-config \
  --description "Application configuration" \
  --secret-string '{
    "OPENAI_API_KEY":"your_openai_api_key",
    "GOOGLE_CLIENT_ID":"your_google_client_id",
    "GOOGLE_CLIENT_SECRET":"your_google_client_secret",
    "JWT_SECRET":"'$(openssl rand -base64 64)'"
  }' \
  --region us-east-2
```

## Step 5: Create AWS Infrastructure

```bash
# Create ECR repository
aws ecr create-repository \
  --repository-name plc-coach-backend \
  --region us-east-2

# Create S3 bucket for frontend
aws s3 mb s3://plc-coach-frontend-$(whoami)-$(date +%s) --region us-east-2

# Enable static website hosting
BUCKET_NAME="plc-coach-frontend-$(whoami)-$(date +%s)"
aws s3 website s3://$BUCKET_NAME \
  --index-document index.html \
  --error-document index.html

# Disable public access blocks
aws s3api put-public-access-block \
  --bucket $BUCKET_NAME \
  --public-access-block-configuration \
    "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

# Set bucket policy
cat > /tmp/s3-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadGetObject",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$BUCKET_NAME/*"
  }]
}
EOF

aws s3api put-bucket-policy \
  --bucket $BUCKET_NAME \
  --policy file:///tmp/s3-policy.json

# Create CloudFront distribution (this is complex, use AWS Console instead)
# Go to CloudFront console and create distribution pointing to your S3 bucket
```

## Step 6: Create GitHub OIDC Provider and IAM Role

```bash
# Create OIDC provider (if not already exists)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# Create trust policy
GITHUB_REPO="YourUsername/YourRepo"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

cat > /tmp/github-trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:*"
      }
    }
  }]
}
EOF

# Create role
aws iam create-role \
  --role-name GitHubActionsDeployRole \
  --assume-role-policy-document file:///tmp/github-trust-policy.json

# Attach policies
aws iam attach-role-policy \
  --role-name GitHubActionsDeployRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser

aws iam attach-role-policy \
  --role-name GitHubActionsDeployRole \
  --policy-arn arn:aws:iam::aws:policy/AWSAppRunnerFullAccess

aws iam attach-role-policy \
  --role-name GitHubActionsDeployRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

aws iam attach-role-policy \
  --role-name GitHubActionsDeployRole \
  --policy-arn arn:aws:iam::aws:policy/CloudFrontFullAccess

# Get role ARN
aws iam get-role --role-name GitHubActionsDeployRole --query 'Role.Arn' --output text
```

## Step 7: Create App Runner Service

Use AWS Console (easier than CLI):

1. Go to **App Runner** console
2. Click **Create service**
3. **Source**: Container registry → Amazon ECR
4. **Image**: Your ECR repository (will be empty initially, CI/CD will populate)
5. **Service name**: `plc-coach-backend`
6. **Port**: 8080
7. **CPU/Memory**: 1 vCPU, 2 GB
8. **Environment variables from Secrets Manager**:
   - Reference `plc-coach/rds-credentials` for DATABASE_URL components
   - Reference `plc-coach/app-config` for other vars
9. **VPC Connector**: Create new (to access RDS)
10. Create service and save the Service ARN and URL

## Step 8: Add GitHub Secrets (Automated)

Install GitHub CLI:
```bash
# macOS
brew install gh

# Authenticate
gh auth login
```

Then run this script to add all secrets:

```bash
#!/bin/bash

# Get your values
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION="us-east-2"
GITHUB_REPO="YourUsername/YourRepo"

# Get App Runner service ARN (replace with your service name)
SERVICE_ARN=$(aws apprunner list-services --region $REGION \
  --query 'ServiceSummaryList[?ServiceName==`plc-coach-backend`].ServiceArn' \
  --output text)

# Get App Runner URL
SERVICE_URL=$(aws apprunner list-services --region $REGION \
  --query 'ServiceSummaryList[?ServiceName==`plc-coach-backend`].ServiceUrl' \
  --output text)

# Get CloudFront distribution ID (you'll need to create this first)
CLOUDFRONT_ID="YOUR_CLOUDFRONT_DISTRIBUTION_ID"

# Add GitHub secrets
gh secret set AWS_ROLE_ARN \
  --body "arn:aws:iam::${ACCOUNT_ID}:role/GitHubActionsDeployRole" \
  --repo $GITHUB_REPO

gh secret set APP_RUNNER_SERVICE_ARN \
  --body "$SERVICE_ARN" \
  --repo $GITHUB_REPO

gh secret set BACKEND_API_URL \
  --body "https://$SERVICE_URL" \
  --repo $GITHUB_REPO

gh secret set CLOUDFRONT_DISTRIBUTION_ID \
  --body "$CLOUDFRONT_ID" \
  --repo $GITHUB_REPO

echo "✅ GitHub secrets added successfully!"
```

## Step 9: Configure Google OAuth

**This must be done manually** - Google doesn't provide an API for this.

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Navigate to **APIs & Services** → **Credentials**
3. Click your OAuth 2.0 Client ID
4. Add **Authorized redirect URIs**:
   ```
   https://YOUR_APP_RUNNER_URL/auth/google/callback
   http://localhost:3001/auth/google/callback
   ```
5. Add **Authorized JavaScript origins**:
   ```
   https://YOUR_CLOUDFRONT_URL
   https://YOUR_APP_RUNNER_URL
   http://localhost:3000
   ```
6. Click **Save**

## Step 10: Deploy!

```bash
git add .
git commit -m "Initial deployment"
git push origin master
```

GitHub Actions will automatically deploy everything!

---

## Quick Setup Script (All-in-One)

Save this as `setup-aws-infrastructure.sh`:

```bash
#!/bin/bash
set -e

echo "🚀 Setting up AWS infrastructure for PLC Coach"

# Variables - CUSTOMIZE THESE
REGION="us-east-2"
DB_PASSWORD=$(openssl rand -base64 32)
BUCKET_SUFFIX=$(whoami)-$(date +%s)
GITHUB_REPO="YourUsername/YourRepo"

echo "📦 Step 1: Creating ECR repository..."
aws ecr create-repository --repository-name plc-coach-backend --region $REGION

echo "🗄️  Step 2: Creating RDS PostgreSQL..."
aws rds create-db-instance \
  --db-instance-identifier plc-coach-db \
  --db-instance-class db.t3.medium \
  --engine postgres \
  --engine-version 15.4 \
  --master-username postgres \
  --master-user-password "$DB_PASSWORD" \
  --allocated-storage 50 \
  --storage-type gp3 \
  --db-name plccoach \
  --publicly-accessible \
  --region $REGION

echo "⏳ Waiting for database to be available (10-15 min)..."
aws rds wait db-instance-available --db-instance-identifier plc-coach-db --region $REGION

RDS_ENDPOINT=$(aws rds describe-db-instances \
  --db-instance-identifier plc-coach-db \
  --region $REGION \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text)

echo "✅ Database created at: $RDS_ENDPOINT"
echo "⚠️  SAVE THIS PASSWORD: $DB_PASSWORD"

echo "🪣 Step 3: Creating S3 bucket..."
BUCKET_NAME="plc-coach-frontend-$BUCKET_SUFFIX"
aws s3 mb s3://$BUCKET_NAME --region $REGION
aws s3 website s3://$BUCKET_NAME --index-document index.html --error-document index.html

echo "🔐 Step 4: Creating secrets..."
aws secretsmanager create-secret \
  --name plc-coach/rds-credentials \
  --secret-string "{\"username\":\"postgres\",\"password\":\"$DB_PASSWORD\",\"host\":\"$RDS_ENDPOINT\"}" \
  --region $REGION

echo "🎭 Step 5: Creating IAM role for GitHub Actions..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

cat > /tmp/trust-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {"token.actions.githubusercontent.com:aud": "sts.amazonaws.com"},
      "StringLike": {"token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:*"}
    }
  }]
}
EOF

aws iam create-role --role-name GitHubActionsDeployRole --assume-role-policy-document file:///tmp/trust-policy.json
aws iam attach-role-policy --role-name GitHubActionsDeployRole --policy-arn arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryPowerUser
aws iam attach-role-policy --role-name GitHubActionsDeployRole --policy-arn arn:aws:iam::aws:policy/AWSAppRunnerFullAccess
aws iam attach-role-policy --role-name GitHubActionsDeployRole --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess
aws iam attach-role-policy --role-name GitHubActionsDeployRole --policy-arn arn:aws:iam::aws:policy/CloudFrontFullAccess

echo "✅ Setup complete!"
echo ""
echo "📝 NEXT STEPS:"
echo "1. Connect to database and install pgvector:"
echo "   psql -h $RDS_ENDPOINT -U postgres -d plccoach"
echo "   CREATE EXTENSION vector;"
echo ""
echo "2. Make database private:"
echo "   aws rds modify-db-instance --db-instance-identifier plc-coach-db --no-publicly-accessible --apply-immediately --region $REGION"
echo ""
echo "3. Create App Runner service in AWS Console"
echo "4. Create CloudFront distribution in AWS Console"
echo "5. Run the GitHub secrets script above"
echo "6. Configure Google OAuth redirect URIs"
echo "7. Push to GitHub!"
```

Run it:
```bash
chmod +x setup-aws-infrastructure.sh
./setup-aws-infrastructure.sh
```
