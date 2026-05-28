#!/bin/bash
# ============================================
# NullName DB - Uninstall Script
# No brand. No name. No payment.
# Version: 2.0.0
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'
BOLD='\033[1m'

# Directories
INSTALL_DIR="/opt/nullname"
DATA_DIR="/var/lib/nullname"
LOG_DIR="/var/log/nullname"
CONFIG_DIR="/etc/nullname"
SERVICE_NAME="nullname"
BACKUP_DIR="$HOME/nullname_backup_$(date +%Y%m%d_%H%M%S)"

# ============================================
# UTILITY FUNCTIONS
# ============================================

print_header() {
    echo ""
    echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║                                                              ║${NC}"
    echo -e "${RED}║   NullName DB Uninstall Script                               ║${NC}"
    echo -e "${RED}║                                                              ║${NC}"
    echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_info() { echo -e "${BLUE}ℹ${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_step() { echo ""; echo -e "${BOLD}${CYAN}>>>${NC} ${BOLD}$1${NC}"; }

confirm() {
    echo ""
    read -p "$1 (y/N): " -n 1 -r
    echo ""
    [[ $REPLY =~ ^[Yy]$ ]]
}

confirm_delete() {
    echo ""
    echo -e "${RED}${BOLD}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}${BOLD}║  ⚠️  WARNING: This action is IRREVERSIBLE!                    ║${NC}"
    echo -e "${RED}${BOLD}║  All databases, files, and configurations will be DELETED.   ║${NC}"
    echo -e "${RED}${BOLD}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    read -p "Type 'DELETE' to confirm uninstallation: " CONFIRM_TEXT
    echo ""
    
    if [ "$CONFIRM_TEXT" != "DELETE" ]; then
        echo -e "${YELLOW}Uninstallation cancelled.${NC}"
        exit 0
    fi
}

# ============================================
# CHECK INSTALLATION
# ============================================

check_installation() {
    print_step "Checking installation..."
    
    FOUND=false
    
    if [ -d "$INSTALL_DIR" ]; then
        print_info "Found installation at: $INSTALL_DIR"
        FOUND=true
    fi
    
    if [ -d "$DATA_DIR" ]; then
        print_info "Found data at: $DATA_DIR"
        FOUND=true
    fi
    
    if command -v systemctl &> /dev/null && systemctl list-units --full -all 2>/dev/null | grep -q "$SERVICE_NAME.service"; then
        print_info "Found systemd service: $SERVICE_NAME"
        FOUND=true
    fi
    
    if [ -f "$HOME/Library/LaunchAgents/com.nullname.db.plist" ]; then
        print_info "Found launchd service: com.nullname.db"
        FOUND=true
    fi
    
    if [ "$FOUND" = false ]; then
        print_error "NullName DB installation not found."
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo ""
        [[ ! $REPLY =~ ^[Yy]$ ]] && exit 0
    fi
}

# ============================================
# BACKUP
# ============================================

create_backup() {
    print_step "Create backup before uninstall?"
    
    if confirm "Do you want to create a backup of your data?"; then
        print_info "Creating backup at: $BACKUP_DIR"
        mkdir -p "$BACKUP_DIR"
        
        # Backup data
        if [ -d "$DATA_DIR" ]; then
            cp -r "$DATA_DIR" "$BACKUP_DIR/data" 2>/dev/null && print_success "Data backed up"
        fi
        
        # Backup installation database
        if [ -d "$INSTALL_DIR/database" ]; then
            cp -r "$INSTALL_DIR/database" "$BACKUP_DIR/database" 2>/dev/null && print_success "Database backed up"
        fi
        
        # Backup configuration
        if [ -f "$INSTALL_DIR/.env" ]; then
            cp "$INSTALL_DIR/.env" "$BACKUP_DIR/.env" && print_success "Configuration backed up"
        fi
        
        if [ -d "$CONFIG_DIR" ]; then
            cp -r "$CONFIG_DIR" "$BACKUP_DIR/config" 2>/dev/null && print_success "Config directory backed up"
        fi
        
        # Backup logs
        if [ -d "$LOG_DIR" ]; then
            cp -r "$LOG_DIR" "$BACKUP_DIR/logs" 2>/dev/null && print_success "Logs backed up"
        fi
        
        # Create backup info file
        cat > "$BACKUP_DIR/backup_info.txt" << EOF
NullName DB Backup
==================
Date: $(date)
Hostname: $(hostname)
User: $(whoami)

Installation: $INSTALL_DIR
Data: $DATA_DIR
Logs: $LOG_DIR

To restore:
1. Reinstall NullName DB
2. Stop the service
3. Copy backup files to original locations
4. Restart the service
EOF
        
        echo ""
        print_success "Backup created at: $BACKUP_DIR"
        echo "  Size: $(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)"
    else
        print_info "Skipping backup"
    fi
}

# ============================================
# STOP SERVICES
# ============================================

stop_services() {
    print_step "Stopping services..."
    
    # Systemd
    if command -v systemctl &> /dev/null; then
        if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
            sudo systemctl stop "$SERVICE_NAME"
            print_success "Systemd service stopped"
        fi
        
        if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
            sudo systemctl disable "$SERVICE_NAME"
            print_success "Systemd service disabled"
        fi
    fi
    
    # Launchd (macOS)
    if [ -f "$HOME/Library/LaunchAgents/com.nullname.db.plist" ]; then
        launchctl unload "$HOME/Library/LaunchAgents/com.nullname.db.plist" 2>/dev/null && print_success "Launchd service unloaded"
    fi
    
    # PM2
    if command -v pm2 &> /dev/null; then
        if pm2 list 2>/dev/null | grep -q "$SERVICE_NAME"; then
            pm2 stop "$SERVICE_NAME" 2>/dev/null || true
            pm2 delete "$SERVICE_NAME" 2>/dev/null || true
            print_success "PM2 process removed"
        fi
    fi
    
    # Direct node processes
    pkill -f "node.*$INSTALL_DIR/server.js" 2>/dev/null && print_success "Node process killed" || true
    
    # Wait for processes to terminate
    sleep 2
}

# ============================================
# REMOVE FILES
# ============================================

remove_systemd_service() {
    print_step "Removing systemd service..."
    
    if [ -f "/etc/systemd/system/$SERVICE_NAME.service" ]; then
        sudo rm -f "/etc/systemd/system/$SERVICE_NAME.service"
        print_success "Service file removed"
    fi
    
    sudo systemctl daemon-reload 2>/dev/null || true
    sudo systemctl reset-failed 2>/dev/null || true
}

remove_launchd_service() {
    print_step "Removing launchd service..."
    
    LAUNCHD_PLIST="$HOME/Library/LaunchAgents/com.nullname.db.plist"
    if [ -f "$LAUNCHD_PLIST" ]; then
        rm -f "$LAUNCHD_PLIST"
        print_success "Launchd plist removed"
    fi
}

remove_nginx_config() {
    print_step "Removing Nginx configuration..."
    
    NGINX_AVAILABLE="/etc/nginx/sites-available/$SERVICE_NAME"
    NGINX_ENABLED="/etc/nginx/sites-enabled/$SERVICE_NAME"
    
    if [ -f "$NGINX_AVAILABLE" ]; then
        sudo rm -f "$NGINX_AVAILABLE"
        print_success "Nginx config removed"
    fi
    
    if [ -L "$NGINX_ENABLED" ]; then
        sudo rm -f "$NGINX_ENABLED"
        print_success "Nginx symlink removed"
    fi
    
    # Reload nginx if available
    if command -v nginx &> /dev/null; then
        sudo nginx -t 2>/dev/null && sudo systemctl reload nginx 2>/dev/null || true
    fi
}

remove_ssl_certificates() {
    print_step "Checking for SSL certificates..."
    
    # Extract domain from old config if exists
    if [ -f "$INSTALL_DIR/.env" ]; then
        DOMAIN=$(grep "^DOMAIN=" "$INSTALL_DIR/.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' | tr -d "'" || echo "")
    fi
    
    if [ -n "$DOMAIN" ] && command -v certbot &> /dev/null; then
        if confirm "Remove Let's Encrypt SSL certificate for $DOMAIN?"; then
            sudo certbot delete --cert-name "$DOMAIN" --non-interactive 2>/dev/null || true
            print_success "SSL certificate removed"
        else
            print_info "SSL certificate kept"
        fi
    fi
}

remove_directories() {
    print_step "Removing directories and files..."
    
    # Installation directory
    if [ -d "$INSTALL_DIR" ]; then
        sudo rm -rf "$INSTALL_DIR"
        print_success "Removed: $INSTALL_DIR"
    fi
    
    # Data directory
    if [ -d "$DATA_DIR" ]; then
        sudo rm -rf "$DATA_DIR"
        print_success "Removed: $DATA_DIR"
    fi
    
    # Log directory
    if [ -d "$LOG_DIR" ]; then
        sudo rm -rf "$LOG_DIR"
        print_success "Removed: $LOG_DIR"
    fi
    
    # Config directory
    if [ -d "$CONFIG_DIR" ]; then
        sudo rm -rf "$CONFIG_DIR"
        print_success "Removed: $CONFIG_DIR"
    fi
    
    # Any remaining database files in home
    if [ -d "$HOME/.nullname" ]; then
        rm -rf "$HOME/.nullname"
        print_success "Removed: $HOME/.nullname"
    fi
}

remove_cron_jobs() {
    print_step "Removing cron jobs..."
    
    if command -v crontab &> /dev/null; then
        crontab -l 2>/dev/null | grep -v "nullname" | crontab - 2>/dev/null || true
        print_success "Cron jobs removed"
    fi
}

remove_docker() {
    print_step "Checking for Docker containers..."
    
    if command -v docker &> /dev/null; then
        if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q "^$SERVICE_NAME$"; then
            docker stop "$SERVICE_NAME" 2>/dev/null || true
            docker rm "$SERVICE_NAME" 2>/dev/null || true
            print_success "Docker container removed"
        fi
        
        if docker image ls --format '{{.Repository}}' 2>/dev/null | grep -q "nullname"; then
            if confirm "Remove NullName DB Docker images?"; then
                docker rmi $(docker images | grep nullname | awk '{print $3}') 2>/dev/null || true
                print_success "Docker images removed"
            fi
        fi
    fi
}

# ============================================
# FINAL CLEANUP
# ============================================

cleanup_system() {
    print_step "Final cleanup..."
    
    # Remove from PATH if added
    if grep -q "$INSTALL_DIR" "$HOME/.bashrc" 2>/dev/null; then
        sed -i '/nullname/d' "$HOME/.bashrc" 2>/dev/null || true
    fi
    
    if grep -q "$INSTALL_DIR" "$HOME/.zshrc" 2>/dev/null; then
        sed -i '/nullname/d' "$HOME/.zshrc" 2>/dev/null || true
    fi
    
    print_success "Path entries cleaned"
}

print_summary() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}║   NullName DB Uninstalled Successfully                       ║${NC}"
    echo -e "${GREEN}║                                                              ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    if [ -d "$BACKUP_DIR" ]; then
        echo -e "${CYAN}📦 Backup saved at:${NC}"
        echo "   $BACKUP_DIR"
        echo ""
        echo -e "${CYAN}To restore:${NC}"
        echo "   1. Reinstall NullName DB"
        echo "   2. Stop the service"
        echo "   3. Copy backup files to original locations"
        echo "   4. Restart the service"
        echo ""
    fi
    
    echo -e "${CYAN}🗑️  Removed components:${NC}"
    echo "   ✓ Installation: $INSTALL_DIR"
    echo "   ✓ Data: $DATA_DIR"
    echo "   ✓ Logs: $LOG_DIR"
    echo "   ✓ Configuration: $CONFIG_DIR"
    echo "   ✓ Systemd service: $SERVICE_NAME"
    echo "   ✓ Nginx configuration"
    echo "   ✓ Cron jobs"
    echo "   ✓ Docker containers (if any)"
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║   Thank you for using NullName DB                             ║${NC}"
    echo -e "${CYAN}║   No brand. No name. No payment.                              ║${NC}"
    echo -e "${CYAN}║                                                              ║${NC}"
    echo -e "${CYAN}║   If you enjoyed using NullName DB, consider starring us on   ║${NC}"
    echo -e "${CYAN}║   GitHub: https://github.com/nullnamedb/system               ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# ============================================
# MAIN
# ============================================

main() {
    print_header
    
    # Check if running as root
    if [ "$EUID" -eq 0 ]; then
        print_warning "Running as root. This will remove system-wide installation."
    fi
    
    confirm_delete
    check_installation
    create_backup
    stop_services
    
    # Removal steps
    remove_systemd_service
    remove_launchd_service
    remove_nginx_config
    remove_ssl_certificates
    remove_directories
    remove_cron_jobs
    remove_docker
    cleanup_system
    
    print_summary
}

main "$@"
