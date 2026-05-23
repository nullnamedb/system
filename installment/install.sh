#!/bin/bash
# ============================================
# NullName DB - Uninstall Script
# No brand. No name. No payment.
# Version: 1.0.0
# ============================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

INSTALL_DIR="/opt/nullname"
DATA_DIR="/var/lib/nullname"
LOG_DIR="/var/log/nullname"
CONFIG_DIR="/etc/nullname"
SERVICE_NAME="nullname"
BACKUP_DIR="$HOME/nullname_backup_$(date +%Y%m%d_%H%M%S)"

print_header() {
    echo ""
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}   NullName DB Uninstall Script${NC}"
    echo -e "${RED}========================================${NC}"
    echo ""
}

print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_info() { echo -e "${BLUE}ℹ${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_step() { echo ""; echo -e "${BOLD}${CYAN}>>>${NC} ${BOLD}$1${NC}"; }

confirm_delete() {
    echo ""
    echo -e "${RED}${BOLD}⚠ WARNING: This action is IRREVERSIBLE!${NC}"
    echo ""
    read -p "Type 'DELETE' to confirm uninstallation: " CONFIRM_TEXT
    echo ""
    if [ "$CONFIRM_TEXT" != "DELETE" ]; then
        echo -e "${YELLOW}Uninstallation cancelled.${NC}"
        exit 0
    fi
}

check_installation() {
    print_step "Checking installation..."
    if [ -d "$INSTALL_DIR" ]; then
        print_info "Found installation at: $INSTALL_DIR"
    else
        print_error "Installation not found at: $INSTALL_DIR"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo ""
        [[ ! $REPLY =~ ^[Yy]$ ]] && exit 0
    fi
    if systemctl list-units --full -all | grep -q "$SERVICE_NAME.service"; then
        print_info "Found systemd service: $SERVICE_NAME"
    fi
}

create_backup() {
    print_step "Create backup before uninstall?"
    read -p "Do you want to create a backup of your data? (y/N): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Creating backup at: $BACKUP_DIR"
        mkdir -p "$BACKUP_DIR"
        [ -d "$DATA_DIR" ] && cp -r "$DATA_DIR" "$BACKUP_DIR/data" 2>/dev/null && print_success "Data backed up"
        [ -d "$INSTALL_DIR/database" ] && cp -r "$INSTALL_DIR/database" "$BACKUP_DIR/database" 2>/dev/null && print_success "Database backed up"
        [ -f "$INSTALL_DIR/.env" ] && cp "$INSTALL_DIR/.env" "$BACKUP_DIR/.env" && print_success "Config backed up"
        [ -d "$LOG_DIR" ] && cp -r "$LOG_DIR" "$BACKUP_DIR/logs" 2>/dev/null && print_success "Logs backed up"
        cat > "$BACKUP_DIR/backup_info.txt" << EOF
NullName DB Backup
Date: $(date)
Installation: $INSTALL_DIR
Data: $DATA_DIR
To restore: Reinstall and copy backup files
EOF
        print_success "Backup created at: $BACKUP_DIR"
    else
        print_info "Skipping backup"
    fi
}

stop_service() {
    print_step "Stopping service..."
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        sudo systemctl stop "$SERVICE_NAME"
        print_success "Service stopped"
    fi
    if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
        sudo systemctl disable "$SERVICE_NAME"
        print_success "Service disabled"
    fi
}

remove_systemd_service() {
    print_step "Removing systemd service..."
    if [ -f "/etc/systemd/system/$SERVICE_NAME.service" ]; then
        sudo rm -f "/etc/systemd/system/$SERVICE_NAME.service"
        print_success "Service file removed"
    fi
    sudo systemctl daemon-reload
    sudo systemctl reset-failed 2>/dev/null || true
}

remove_nginx_config() {
    print_step "Removing Nginx configuration..."
    NGINX_AVAILABLE="/etc/nginx/sites-available/$SERVICE_NAME"
    NGINX_ENABLED="/etc/nginx/sites-enabled/$SERVICE_NAME"
    [ -f "$NGINX_AVAILABLE" ] && sudo rm -f "$NGINX_AVAILABLE" && print_success "Nginx config removed"
    [ -L "$NGINX_ENABLED" ] && sudo rm -f "$NGINX_ENABLED" && print_success "Nginx symlink removed"
    if command -v nginx &> /dev/null; then
        sudo nginx -t 2>/dev/null && sudo systemctl reload nginx 2>/dev/null
    fi
}

remove_ssl_certificates() {
    print_step "Removing SSL certificates..."
    if [ -f "$INSTALL_DIR/.env" ]; then
        DOMAIN=$(grep "^DOMAIN=" "$INSTALL_DIR/.env" | cut -d'=' -f2 | tr -d '"' | tr -d "'")
    fi
    if [ -n "$DOMAIN" ] && command -v certbot &> /dev/null; then
        read -p "Remove Let's Encrypt SSL certificate for $DOMAIN? (y/N): " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sudo certbot delete --cert-name "$DOMAIN" --non-interactive 2>/dev/null || true
            print_success "SSL certificate removed"
        fi
    fi
}

remove_directories() {
    print_step "Removing directories and files..."
    [ -d "$INSTALL_DIR" ] && sudo rm -rf "$INSTALL_DIR" && print_success "Removed: $INSTALL_DIR"
    [ -d "$DATA_DIR" ] && sudo rm -rf "$DATA_DIR" && print_success "Removed: $DATA_DIR"
    [ -d "$LOG_DIR" ] && sudo rm -rf "$LOG_DIR" && print_success "Removed: $LOG_DIR"
    [ -d "$CONFIG_DIR" ] && sudo rm -rf "$CONFIG_DIR" && print_success "Removed: $CONFIG_DIR"
}

remove_pm2_process() {
    if command -v pm2 &> /dev/null; then
        if pm2 list | grep -q "$SERVICE_NAME"; then
            pm2 stop "$SERVICE_NAME" 2>/dev/null || true
            pm2 delete "$SERVICE_NAME" 2>/dev/null || true
            print_success "PM2 process removed"
        fi
    fi
}

remove_docker() {
    if command -v docker &> /dev/null; then
        if docker ps -a --format '{{.Names}}' | grep -q "^$SERVICE_NAME$"; then
            docker stop "$SERVICE_NAME" 2>/dev/null || true
            docker rm "$SERVICE_NAME" 2>/dev/null || true
            print_success "Docker container removed"
        fi
    fi
}

cleanup_cron() {
    if command -v crontab &> /dev/null; then
        crontab -l 2>/dev/null | grep -v "nullname" | crontab - 2>/dev/null || true
    fi
}

print_summary() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}   NullName DB Uninstalled Successfully${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    if [ -d "$BACKUP_DIR" ]; then
        echo -e "${CYAN}Backup saved at:${NC}"
        echo "  $BACKUP_DIR"
        echo ""
        echo -e "${CYAN}To restore:${NC}"
        echo "  1. Reinstall NullName DB"
        echo "  2. Copy backup files to original locations"
        echo ""
    fi
    echo -e "${CYAN}Removed components:${NC}"
    echo "  ✓ Installation: $INSTALL_DIR"
    echo "  ✓ Data: $DATA_DIR"
    echo "  ✓ Logs: $LOG_DIR"
    echo "  ✓ Systemd service: $SERVICE_NAME"
    echo "  ✓ Nginx configuration"
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}   Thank you for using NullName DB${NC}"
    echo -e "${CYAN}   No brand. No name. No payment.${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
}

main() {
    print_header
    if [ "$EUID" -eq 0 ]; then
        print_warning "Running as root."
    fi
    confirm_delete
    check_installation
    create_backup
    stop_service
    remove_systemd_service
    remove_nginx_config
    remove_ssl_certificates
    remove_directories
    remove_pm2_process
    remove_docker
    cleanup_cron
    print_summary
}

main "$@"