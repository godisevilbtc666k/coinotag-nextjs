#!/bin/bash

# Coinotag NestJS API - Google Cloud Run Deployment Script
# Usage: ./deploy-cloudrun-api.sh

set -e

# Configuration
PROJECT_ID="coinotag-en"
SERVICE_NAME="coinotag-api"
REGION="europe-west1"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

echo "🚀 Starting Coinotag API deployment to Google Cloud Run..."

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI is not installed. Please install it first."
    exit 1
fi

# Authenticate and set project
echo "🔐 Setting up Google Cloud project..."
gcloud config set project $PROJECT_ID

# Build and push Docker image
echo "🏗️  Building Docker image..."
docker build -t gcr.io/coinotag-en/coinotag-api .

echo "📦 Pushing image to Google Container Registry..."
docker push gcr.io/coinotag-en/coinotag-api

# Deploy to Cloud Run
echo "🚀 Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/coinotag-en/coinotag-api \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --port 8080 \
  --set-env-vars "NODE_ENV=production" \
  --timeout 300

# Get service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --platform managed --region $REGION --format 'value(status.url)')

echo "✅ Deployment completed!"
echo "🌐 Service URL: $SERVICE_URL"
echo ""
echo "📝 Next steps:"
echo "1. Set up custom domain: api.coinotag.com"
echo "2. Configure SSL certificate"
echo "3. Update DNS records"
echo "4. Set environment variables in Cloud Run console"
echo ""
echo "🔧 To map custom domain:"
echo "gcloud run domain-mappings create --service $SERVICE_NAME --domain api.coinotag.com --region $REGION" 