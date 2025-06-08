#!/bin/bash

# COINOTAG Business News Bot - GCloud Deployment
# $2,200/month Business Package

echo "🚀 COINOTAG Business News Bot Deployment"
echo "========================================="

# Install Python dependencies
echo "📦 Installing Python dependencies..."
pip3 install --user redis requests asyncio

# Set Redis credentials (configure these with your Redis instance)
export REDIS_HOST="your-redis-host"  # Replace with actual Redis host
export REDIS_PORT="6379"
export REDIS_PASSWORD="your-redis-password"  # Replace with actual password

# Make bot executable
chmod +x gcloud-business-news-bot.py

# Create tmux session
echo "🔧 Creating tmux session 'coinotag-business-news'..."
tmux new-session -d -s "coinotag-business-news" "python3 gcloud-business-news-bot.py"

echo "✅ Bot deployed successfully!"
echo ""
echo "📋 Management commands:"
echo "  tmux attach -t coinotag-business-news    # Attach to session"
echo "  tmux kill-session -t coinotag-business-news  # Stop bot"
echo "  tmux ls                                  # List sessions"
echo ""
echo "📊 Monitor logs:"
echo "  tail -f /tmp/coinotag-business-news.log"
echo ""
echo "🔒 Redis Channel: coinotag:business:breaking-news"
echo "💰 Business Package: $2,200/month premium news" 