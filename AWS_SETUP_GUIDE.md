# AWS Setup Guide - AI PLC Coach

Complete step-by-step instructions for deploying the AI PLC Coach on AWS.

## Prerequisites

- AWS Account with billing enabled
- GitHub account (for App Runner deployment)
- Domain name (optional, for custom domain)
- OpenAI API key
- Google OAuth credentials (Client ID + Secret)

## Key Setup Principles

✅ **Managed Secrets**: AWS automatically creates and manages your database password in Secrets Manager
✅ **Private Database**: RDS is NOT publicly accessible - only App Runner can connect via VPC connector
✅ **No PDF Storage**: PDFs are processed in memory and discarded (no S3 storage for documents)
✅ **Simplified Architecture**: Only 3 core services - App Runner, RDS, and S3 (frontend only)

## Architecture Overview

```
                    CloudFront → S3 (Frontend)
                         ↓
User → App Runner (Backend API) → RDS PostgreSQL (pgvector)
                                      ├─ User data
                                      ├─ Chat history
                                      └─ Vector embeddings
```

**Note**: PDFs are processed in memory and discarded after chunking/embedding. No PDF storage needed.

---

## Part 1: Create S3 Bucket for Frontend (3 minutes)

### 1.1 Create Frontend Hosting Bucket

1. Go to **S3** in AWS Console
2. Click **Create bucket**
3. **Bucket name**: `plc-coach-frontend-{your-name}-{random}` (e.g., `plc-coach-frontend-john-x7k2`)
4. **Region**: `us-east-1` (or your preferred region - keep same for all resources)
5. **Block Public Access**: UNCHECK "Block all public access" (we'll use CloudFront)
   - Check the acknowledgment box
6. **Static website hosting**: We'll configure this later
7. Click **Create bucket**

**Save this bucket name** - you'll need it later.

---

## Part 2: Create RDS PostgreSQL Database (15 minutes)

### 2.1 Create Database

1. Go to **RDS** in AWS Console
2. Click **Create database**
3. **Choose a database creation method**: Standard create
4. **Engine options**:
   - Engine type: **PostgreSQL**
   - Version: **PostgreSQL 15.4** (or latest 15.x)
5. **Templates**: **Free tier** (for testing) OR **Dev/Test** (for real use)
6. **Settings**:
   - DB instance identifier: `plc-coach-db`
   - **Credentials management**: Select **"Manage master credentials in AWS Secrets Manager"** ✅
     - AWS will auto-generate a strong password and store it securely
     - Master username: `postgres` (or keep default)
   - **DO NOT** select "Self managed" - let AWS handle it!
7. **Instance configuration**:
   - DB instance class: **db.t3.medium** (2 vCPU, 4 GB RAM)
   - Or **db.t4g.micro** if using free tier
8. **Storage**:
   - Storage type: **General Purpose SSD (gp3)**
   - Allocated storage: **50 GB**
   - Enable storage autoscaling: **Yes**
   - Maximum storage threshold: **100 GB**
9. **Connectivity**:
   - Virtual private cloud (VPC): **Default VPC**
   - Subnet group: **Default**
   - **Public access**: **Yes** (temporary - we'll disable after pgvector setup)
   - VPC security group: **Create new**
     - New VPC security group name: `plc-coach-db-sg`
   - Availability Zone: **No preference**
10. **Database authentication**: **Password authentication**
11. **Additional configuration** (expand):
    - Initial database name: `plccoach`
    - DB parameter group: **default.postgres15**
    - Backup retention: **7 days**
    - Enable encryption: **Yes** (default)
12. Click **Create database**

**Wait 10-15 minutes** for database to be created. Status will show "Available".

### 2.2 Configure Security Group

1. Go to **RDS** → Your database → **Connectivity & security** tab
2. Click on the **VPC security groups** link (e.g., `plc-coach-db-sg`)
3. Click **Edit inbound rules**
4. Click **Add rule**:
   - Type: **PostgreSQL**
   - Protocol: **TCP**
   - Port: **5432**
   - Source: **My IP**
   - Description: `Temp access for pgvector setup`
5. Click **Save rules**

### 2.3 Get Database Password from Secrets Manager

1. Once database is "Available", go to **RDS** → Your database → **Configuration** tab
2. Look for **"Master credentials ARN"** - click the link or copy the secret name
   - It will be something like: `rds!db-a1b2c3d4-e5f6-7890-abcd-ef1234567890`
3. Go to **AWS Secrets Manager** → Find that secret → Click **"Retrieve secret value"**
4. Copy the **password** value (you'll need it for psql)
5. **IMPORTANT**: Copy the full **Secret ARN** - you'll need it for App Runner later

### 2.4 Install pgvector Extension

1. **Copy endpoint** from RDS console (e.g., `plc-coach-db.xxxxx.us-east-1.rds.amazonaws.com`)
2. Install PostgreSQL client on your local machine:
   ```bash
   # macOS
   brew install postgresql@15

   # Ubuntu/Linux
   sudo apt install postgresql-client
   ```
3. Connect to database:
   ```bash
   psql -h plc-coach-db.xxxxx.us-east-1.rds.amazonaws.com \
        -U postgres \
        -d plccoach
   ```
   Enter the master password from Secrets Manager when prompted.

4. Install pgvector extension:
   ```sql
   CREATE EXTENSION vector;

   -- Verify installation
   \dx
   ```
   You should see `vector` in the list of extensions.

5. Exit psql:
   ```sql
   \q
   ```

### 2.5 Secure the Database (IMPORTANT!)

Now that pgvector is installed, make the database private:

1. Go to **RDS** → Your database → Click **Modify**
2. Scroll to **Connectivity** → **Additional configuration**
3. **Public access**: Change to **No** ✅
4. Click **Continue** → **Apply immediately** → **Modify DB instance**
5. Wait 2-3 minutes for modification to complete

6. Remove the temporary public access rule:
   - Go to **RDS** → Your database → **Connectivity & security** tab
   - Click on **VPC security groups** link
   - Click **Edit inbound rules**
   - **Delete** the "My IP" rule you created earlier
   - Click **Save rules**

**Your database is now private** - no public internet access. We'll add App Runner access in Part 5.

---

## Part 3: Set Up Application Secrets (3 minutes)

**Database credentials are already done** - AWS created them automatically in Part 2. You should already have the RDS secret `rds!db-xxxxx` in Secrets Manager.

Now we just need to add a **second secret** for application configuration (OpenAI, Google OAuth, etc.).

1. Go to **AWS Secrets Manager**
2. Click **Store a new secret**

### 3.1 Create Application Configuration Secret

1. **Secret type**: **Other type of secret**
2. Click **Key/value**
3. Add the following key-value pairs:
   ```
   OPENAI_API_KEY: your_openai_api_key
   GOOGLE_CLIENT_ID: your_google_oauth_client_id
   GOOGLE_CLIENT_SECRET: your_google_oauth_client_secret
   JWT_SECRET: (generate random 64-char string)
   ```

   To generate JWT_SECRET on Mac/Linux:
   ```bash
   openssl rand -base64 64
   ```

4. Click **Next**
5. **Secret name**: `plc-coach/app-config`
6. **Description**: Application configuration for PLC Coach
7. Click **Next** → **Next** → **Store**

**Copy the Secret ARN** - you'll need it for App Runner.

### 3.2 Verify Your Secrets

You should now have **2 secrets** in Secrets Manager:
1. `rds!db-xxxxx` (auto-created by RDS) - Database credentials
2. `plc-coach/app-config` (just created) - Application config

**Copy both Secret ARNs** - you'll need them for App Runner configuration.

---

## Part 4: Prepare Backend Code

Before setting up App Runner, prepare your repository:

### 4.1 Create Backend Directory Structure

```bash
cd /Users/shumway/Developer/AIPLC
mkdir -p backend
cd backend
npm init -y
```

### 4.2 Install Dependencies

```bash
npm install express pg pgvector-node openai passport passport-google-oauth20 \
  express-session cors dotenv multer pdf-parse uuid
```

**Note**: No `aws-sdk` needed since we're not storing PDFs in S3.

### 4.3 Create Dockerfile

Create `backend/Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
```

### 4.4 Create .dockerignore

Create `backend/.dockerignore`:

```
node_modules
npm-debug.log
.env
.git
```

### 4.5 Environment Variables

App Runner will inject these. Your code should read from:
- `process.env.DATABASE_USERNAME`
- `process.env.DATABASE_PASSWORD`
- `process.env.DATABASE_HOST`
- `process.env.OPENAI_API_KEY`
- `process.env.GOOGLE_CLIENT_ID`
- `process.env.GOOGLE_CLIENT_SECRET`
- `process.env.JWT_SECRET`

**Database Connection**: Construct the connection string in your code:
```javascript
const DATABASE_URL = `postgresql://${process.env.DATABASE_USERNAME}:${process.env.DATABASE_PASSWORD}@${process.env.DATABASE_HOST}:5432/plccoach`;
```

### 4.6 Push to GitHub

```bash
cd /Users/shumway/Developer/AIPLC
git add .
git commit -m "Initial backend setup for App Runner"
git branch -M main
git remote add origin https://github.com/yourusername/aiplc.git
git push -u origin main
```

---

## Part 5: Set Up AWS App Runner (10 minutes)

### 5.1 Create App Runner Service

1. Go to **App Runner** in AWS Console
2. Click **Create service**

### 5.2 Source Configuration

1. **Repository type**: **Source code repository**
2. Click **Add new** (to connect GitHub)
3. **Connection name**: `github-connection`
4. Click **Install another** → Authorize with GitHub
5. Select your repository: `yourusername/aiplc`
6. **Branch**: `main`
7. Click **Next**

### 5.3 Build Configuration

1. **Configuration file**: Use configuration file (we'll create apprunner.yaml)
2. Or manually configure:
   - **Runtime**: **Node.js 18**
   - **Build command**: `npm install`
   - **Start command**: `node server.js`
   - **Port**: `8080`
3. Click **Next**

### 5.4 Service Configuration

1. **Service name**: `plc-coach-backend`
2. **Virtual CPU**: **1 vCPU**
3. **Memory**: **2 GB**
4. **Environment variables**: Click **Add environment variable**

   Add these as plaintext:
   ```
   NODE_ENV=production
   PORT=8080
   ```

5. **Secrets**: Click **Add secret** for each of these:

   **Database credentials** (from auto-generated RDS secret):
   - **Name**: `DATABASE_USERNAME`
   - **Value type**: **Secrets Manager**
   - **Secret**: Select your RDS secret (e.g., `rds!db-xxxxx`)
   - **Version**: AWSCURRENT
   - **Key**: `username`

   - **Name**: `DATABASE_PASSWORD`
   - **Value type**: **Secrets Manager**
   - **Secret**: Select your RDS secret (e.g., `rds!db-xxxxx`)
   - **Version**: AWSCURRENT
   - **Key**: `password`

   - **Name**: `DATABASE_HOST`
   - **Value type**: **Secrets Manager**
   - **Secret**: Select your RDS secret (e.g., `rds!db-xxxxx`)
   - **Version**: AWSCURRENT
   - **Key**: `host`

   **Application config** (from `plc-coach/app-config`):
   - **Name**: `OPENAI_API_KEY`
   - **Value type**: **Secrets Manager**
   - **Secret**: `plc-coach/app-config`
   - **Version**: AWSCURRENT
   - **Key**: `OPENAI_API_KEY`

   Repeat for:
   - `GOOGLE_CLIENT_ID` → Key: `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET` → Key: `GOOGLE_CLIENT_SECRET`
   - `JWT_SECRET` → Key: `JWT_SECRET`

   **Note**: Your backend code should construct the DATABASE_URL from the individual components:
   ```javascript
   const DATABASE_URL = `postgresql://${process.env.DATABASE_USERNAME}:${process.env.DATABASE_PASSWORD}@${process.env.DATABASE_HOST}:5432/plccoach`;
   ```

6. **Auto scaling**:
   - Min: **1**
   - Max: **3**
   - Concurrency: **100**

7. **Health check**:
   - Protocol: **HTTP**
   - Path: `/health`
   - Interval: **20 seconds**
   - Timeout: **5 seconds**

### 5.5 IAM Role

1. **Instance role**: **Create new service role**
2. Role name will be auto-generated
3. **Attach policies** (App Runner will prompt):
   - `SecretsManagerReadWrite`

**Note**: No S3 access needed since PDFs are processed in memory.

### 5.6 Security

1. **VPC connector**: Create new (to access RDS)
   - Name: `plc-coach-vpc-connector`
   - VPC: Your default VPC
   - Subnets: Select at least 2 subnets
   - Security groups: Create new or select existing

2. Click **Next** → Review → **Create & deploy**

**Wait 5-10 minutes** for deployment. You'll get a URL like:
`https://xxxxx.us-east-1.awsapprunner.com`

### 5.7 Update RDS Security Group to Allow App Runner Access

Now that App Runner is deployed with a VPC connector, allow it to access the database:

1. Find the VPC connector security group:
   - Go to **App Runner** → Your service → **Networking** tab
   - Note the **VPC connector security group ID** (e.g., `sg-xxxxx`)

2. Update RDS security group:
   - Go to **EC2** → **Security Groups** → Find `plc-coach-db-sg`
   - Click **Edit inbound rules**
   - Click **Add rule**:
     - Type: **PostgreSQL**
     - Port: **5432**
     - Source: **Custom** → Paste the App Runner VPC connector security group ID
     - Description: `App Runner access via VPC connector`
   - Click **Save rules**

**Security note**: Your database now only accepts connections from App Runner (via VPC connector). No public internet access. ✅

---

## Part 6: Set Up CloudFront + S3 for Frontend (10 minutes)

### 6.1 Configure S3 Bucket for Static Hosting

1. Go to **S3** → Select `plc-coach-frontend-{suffix}`
2. Go to **Properties** tab
3. Scroll to **Static website hosting** → Click **Edit**
4. Enable: **Enable**
5. Hosting type: **Host a static website**
6. Index document: `index.html`
7. Error document: `index.html` (for React Router)
8. Click **Save changes**

### 6.2 Set Bucket Policy

1. Go to **Permissions** tab
2. Scroll to **Bucket policy** → Click **Edit**
3. Add this policy (replace `YOUR-BUCKET-NAME`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR-BUCKET-NAME/*"
    }
  ]
}
```

4. Click **Save changes**

### 6.3 Create CloudFront Distribution

1. Go to **CloudFront** in AWS Console
2. Click **Create distribution**
3. **Origin domain**: Select your S3 bucket from dropdown
   - Should show: `plc-coach-frontend-{suffix}.s3-website-us-east-1.amazonaws.com`
4. **Origin path**: Leave blank
5. **Name**: Auto-filled
6. **Enable Origin Shield**: No
7. **Viewer protocol policy**: **Redirect HTTP to HTTPS**
8. **Allowed HTTP methods**: **GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE**
9. **Cache policy**: **CachingOptimized**
10. **Origin request policy**: None
11. **Response headers policy**: None (or create custom for CORS)
12. **Alternate domain names (CNAMEs)**: Add your domain if you have one
13. **SSL certificate**: Default or select ACM certificate
14. **Default root object**: `index.html`
15. **Custom error responses**: Click **Create custom error response**
    - HTTP error code: **404**
    - Response page path: `/index.html`
    - HTTP response code: **200**
    - Click **Create**
16. Click **Create distribution**

**Wait 5-10 minutes** for deployment. Copy the **Distribution domain name**:
`dxxxxx.cloudfront.net`

---

## Part 7: Build and Deploy Frontend

### 7.1 Update Frontend Configuration

Create `frontend/.env.production`:

```bash
REACT_APP_API_URL=https://xxxxx.us-east-1.awsapprunner.com
REACT_APP_GOOGLE_CLIENT_ID=your_google_client_id
```

### 7.2 Build React App

```bash
cd frontend
npm install
npm run build
```

### 7.3 Deploy to S3

```bash
# Install AWS CLI if needed
# brew install awscli  # macOS
# pip install awscli   # Linux/Windows

# Configure AWS CLI
aws configure
# Enter: Access Key ID, Secret Access Key, Region (us-east-1), Output format (json)

# Sync build to S3
aws s3 sync build/ s3://plc-coach-frontend-{your-suffix}/ --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id YOUR-DISTRIBUTION-ID \
  --paths "/*"
```

---

## Part 8: Final Configuration

### 8.1 Update Google OAuth Redirect URIs

1. Go to Google Cloud Console → APIs & Services → Credentials
2. Edit your OAuth 2.0 Client ID
3. Add authorized redirect URIs:
   ```
   https://xxxxx.us-east-1.awsapprunner.com/auth/google/callback
   https://dxxxxx.cloudfront.net
   ```
4. Save

### 8.2 Configure CORS on Backend

Ensure your backend allows requests from CloudFront:

```javascript
const cors = require('cors');

app.use(cors({
  origin: [
    'https://dxxxxx.cloudfront.net',
    'http://localhost:3000' // for local development
  ],
  credentials: true
}));
```

### 8.3 Test the Application

1. Visit your CloudFront URL: `https://dxxxxx.cloudfront.net`
2. Test Google login
3. Upload a test PDF
4. Ask questions

---

## Part 9: Custom Domain (Optional)

### 9.1 Request SSL Certificate

1. Go to **AWS Certificate Manager (ACM)**
2. Make sure you're in **us-east-1** region (required for CloudFront)
3. Click **Request certificate**
4. **Certificate type**: Public certificate
5. **Domain names**:
   - `plccoach.yourdomain.com`
   - `api.plccoach.yourdomain.com`
6. **Validation method**: DNS validation
7. Click **Request**
8. Follow validation instructions (add CNAME to your DNS)

### 9.2 Update CloudFront Distribution

1. Go to **CloudFront** → Your distribution → **Edit**
2. **Alternate domain names**: `plccoach.yourdomain.com`
3. **Custom SSL certificate**: Select your ACM certificate
4. Save changes

### 9.3 Update Route 53 (or your DNS provider)

1. Go to **Route 53** → Hosted zones
2. Create record:
   - **Record name**: `plccoach`
   - **Record type**: **A - Routes traffic to an IPv4 address**
   - **Alias**: Yes
   - **Route traffic to**: CloudFront distribution
   - **Select distribution**: Your distribution
3. Create another record for API:
   - **Record name**: `api.plccoach`
   - **Record type**: **CNAME**
   - **Value**: Your App Runner URL

---

## Monitoring & Maintenance

### CloudWatch Logs
- **App Runner logs**: Automatic, view in App Runner console
- **RDS logs**: Enable in RDS → Configuration → Logs

### Cost Monitoring
1. Enable **AWS Cost Explorer**
2. Set up **Budget alerts** (e.g., alert if >$150/month)

### Backups
- **RDS**: Automatic backups enabled (7-day retention)
- **Note**: Original PDFs are not stored, only vector embeddings in database

---

## Troubleshooting

### App Runner won't connect to RDS
- Check VPC connector is in same VPC as RDS
- Verify security group allows traffic from VPC connector
- Verify Secrets Manager environment variables are configured correctly:
  - `DATABASE_USERNAME`, `DATABASE_PASSWORD`, `DATABASE_HOST` from RDS secret
- Check database connection string construction in code
- Verify RDS secret in Secrets Manager has correct keys: `username`, `password`, `host`

### Frontend can't reach backend
- Check CORS configuration
- Verify App Runner URL in frontend .env
- Check App Runner health check is passing

### PDFs not processing
- Check multer middleware configuration for file uploads
- Verify pdf-parse is installed correctly
- Review CloudWatch logs for extraction errors
- Check OpenAI API key is valid (for embeddings)

---

## Next Steps

1. Set up database migrations (use tools like `node-pg-migrate`)
2. Implement proper error logging (Sentry, DataDog)
3. Set up CI/CD pipeline (GitHub Actions)
4. Configure production environment variables
5. Load test data (OpenStax PDFs)
6. Performance testing and optimization

---

## Cost Breakdown (Monthly Estimate)

- **App Runner**: $25-50 (based on usage)
- **RDS db.t3.medium**: ~$60
- **S3 (frontend only) + CloudFront**: ~$2-5
- **Secrets Manager**: ~$1
- **Data transfer**: ~$5-10
- **Total**: ~$95-125/month

**Note**: Costs reduced by ~$5-10/month by not storing PDFs in S3.

## Security Checklist

- [ ] **RDS not publicly accessible** ✅ (private, only accessible via VPC connector)
- [ ] **RDS security group only allows App Runner VPC connector** ✅
- [ ] **Database credentials managed by AWS Secrets Manager** ✅
- [ ] S3 frontend bucket properly configured (CloudFront access only)
- [ ] All secrets stored in Secrets Manager (not hardcoded)
- [ ] HTTPS enforced on CloudFront
- [ ] IAM roles follow least privilege (App Runner only has Secrets Manager access)
- [ ] File upload size limits enforced (prevent DoS via large PDFs)
- [ ] PDF file type validation in backend
- [ ] Enable AWS CloudTrail for audit logs
- [ ] Set up AWS GuardDuty for threat detection
- [ ] Regular security updates for dependencies

---

**Setup Complete!** You now have a fully functional AWS deployment.

For questions or issues, check:
- [AWS App Runner Docs](https://docs.aws.amazon.com/apprunner/)
- [RDS PostgreSQL Docs](https://docs.aws.amazon.com/rds/postgres/)
- [pgvector GitHub](https://github.com/pgvector/pgvector)
