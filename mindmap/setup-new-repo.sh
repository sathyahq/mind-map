#!/bin/bash
# This script copies the mindmap app into your new GitHub repo and pushes it.
# Usage: Run this script from anywhere on your computer.

set -e

echo ""
echo "=== Mind Map - Setting up your new repo ==="
echo ""

# Clone the new empty repo
echo "Step 1/4: Downloading your new repo..."
rm -rf /tmp/mindmap-setup
git clone https://github.com/sathyahq/mindmap.git /tmp/mindmap-setup

# Figure out where this script lives (that's where the mindmap files are)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Copy all the app files
echo "Step 2/4: Copying mind map files..."
cp "$SCRIPT_DIR/server.js" /tmp/mindmap-setup/
cp "$SCRIPT_DIR/package.json" /tmp/mindmap-setup/
cp "$SCRIPT_DIR/package-lock.json" /tmp/mindmap-setup/
cp "$SCRIPT_DIR/README.md" /tmp/mindmap-setup/
cp "$SCRIPT_DIR/.gitignore" /tmp/mindmap-setup/
mkdir -p /tmp/mindmap-setup/public
cp "$SCRIPT_DIR/public/index.html" /tmp/mindmap-setup/public/
cp "$SCRIPT_DIR/public/app.js" /tmp/mindmap-setup/public/
cp "$SCRIPT_DIR/public/style.css" /tmp/mindmap-setup/public/

# Commit and push
echo "Step 3/4: Pushing to GitHub..."
cd /tmp/mindmap-setup
git add .
git commit -m "Initial commit: personal mind mapping app"
git push origin main

echo "Step 4/4: Done!"
echo ""
echo "=== SUCCESS ==="
echo ""
echo "Your mind map app is now at: https://github.com/sathyahq/mindmap"
echo ""
echo "To run it on your computer:"
echo "  cd /tmp/mindmap-setup"
echo "  npm install"
echo "  npm start"
echo ""
echo "Then open http://localhost:3000 in your browser."
echo ""
