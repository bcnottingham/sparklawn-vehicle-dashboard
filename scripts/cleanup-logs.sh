#!/bin/bash

# Log cleanup script - removes .log and .gz files older than 7 days

LOG_DIR="logs"

# Check if logs directory exists
if [ ! -d "$LOG_DIR" ]; then
    echo "Logs directory not found: $LOG_DIR"
    exit 1
fi

echo "Starting log cleanup in $LOG_DIR..."

# Get current disk usage
BEFORE_SIZE=$(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)
echo "Current logs directory size: $BEFORE_SIZE"

# Find and delete .log files older than 7 days
DELETED_LOGS=$(find "$LOG_DIR" -name "*.log" -type f -mtime +7 2>/dev/null)
if [ ! -z "$DELETED_LOGS" ]; then
    echo "Deleting old .log files:"
    echo "$DELETED_LOGS"
    find "$LOG_DIR" -name "*.log" -type f -mtime +7 -delete 2>/dev/null
else
    echo "No .log files older than 7 days found"
fi

# Find and delete .gz files older than 7 days
DELETED_GZ=$(find "$LOG_DIR" -name "*.gz" -type f -mtime +7 2>/dev/null)
if [ ! -z "$DELETED_GZ" ]; then
    echo "Deleting old .gz files:"
    echo "$DELETED_GZ"
    find "$LOG_DIR" -name "*.gz" -type f -mtime +7 -delete 2>/dev/null
else
    echo "No .gz files older than 7 days found"
fi

# Get final disk usage
AFTER_SIZE=$(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)
echo "Logs directory size after cleanup: $AFTER_SIZE"

# List remaining files
echo "Remaining log files:"
ls -lah "$LOG_DIR" 2>/dev/null || echo "No files in logs directory"

echo "Log cleanup completed!"