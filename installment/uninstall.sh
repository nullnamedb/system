#!/bin/bash
# ============================================
# NullName DB - Uninstall Script
# No brand. No name. No payment.
# Version: 1.0.0
# ============================================

set -e

# ============================================
# COLORS
# ============================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# ============================================
# CONFIGURATION
# ============================================

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
    echo -e "${RED}========================================${NC}"
    echo -e "${RED}   NullName DB Uninstall Script${NC}"
    echo -e "${RED}========================================${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_step() {
    echo ""
    echo -e "${BOLD}${CYAN}>>>${NC} ${BOLD}$1${NC}"
}

confirm() {
    echo ""
    read -p "$1 (y/N): " -n 1 -r
    echo ""
    [[ $REPLY =~ ^[Yy]$ ]]
}

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

# ============================================
# CHECK INSTALLATION
# ============================================

check_installation() {
    print_step "Checking installation..."
    
    INSTALLED=false
    
    if [ -d "$INSTALL_DIR" ]; then
        INSTALLED=true
        print_info "Found installation at: $INSTALL_DIR"
    else
        print_error "Installation not found at: $INSTALL_DIR"
        echo ""
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 0
        fi
    fi
    
    if systemctl list-units --full -all | grep -q "$SERVICE_NAME.service"; then
        print_info "Found systemd service: $SERVICE_NAME"
    fi
}

# ============================================
# CREATE BACKUP (OPTIONAL)
# ============================================

create_backup() {
    print_step "Create backup before uninstall?"
    
    if confirm "Do you want to create a backup of your data before uninstalling?"; then
        print_info "Creating backup at: $BACKUP_DIR"
        
        mkdir -p "$BACKUP_DIR"
        
        # Backup data directory
        if [ -d "$DATA_DIR" ]; then
            cp -r "$DATA_DIR" "$BACKUP_DIR/data"
            print_success "Data backed up"
        fi
        
        # Backup installation directory
        if [ -d "$INSTALL_DIR/database" ]; then
            cp -r "$INSTALL_DIR/database" "$BACKUP_DIR/database"
            print_success "Database backed up"
        fi
        
        # Backup configuration
        if [ -f "$INSTALL_DIR/.env" ]; then
            cp "$INSTALL_DIR/.env" "$BACKUP_DIR/.env"
            print_success "Configuration backed up"
        fi
        
        # Backup logs
        if [ -d "$LOG_DIR" ]; then
            cp -r "$LOG_DIR" "$BACKUP_DIR/logs" 2>/dev/null || true
            print_success "Logs backed up"
        fi
        
        # Create info file
        cat > "$BACKUP_DIR/backup_info.txt" << EOF
NullName DB Backup
Date: $(date)
Installation Directory: $INSTALL_DIR
Data Directory: $DATA_DIR
Log Directory: $LOG_DIR

To restore:
1. Reinstall NullName DB
2. Copy backup files to appropriate directories
3. Set proper permissions
EOF
        
        echo ""
        print_success "Backup created at: $BACKUP_DIR"
        print_info "Backup size: $(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)"
    else
        print_info "Skipping backup"
    fi
}

# ============================================
# STOP SERVICE
# ============================================

stop_service() {
    print_step "Stopping service..."
    
    if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
        sudo systemctl stop "$SERVICE_NAME"
        print_success "Service stopped"
    else
        print_info "Service not running"
    fi
    
    if systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
        sudo systemctl disable "$SERVICE_NAME"
        print_success "Service disabled"
    fi
}

# ============================================
# REMOVE SYSTEMD SERVICE
# ============================================

remove_systemd_service() {
    print_step "Removing systemd service..."
    
    if [ -f "/etc/systemd/system/$SERVICE_NAME.service" ]; then
        sudo rm -f "/etc/systemd/system/$SERVICE_NAME.service"
        print_success "Service file removed"
    fi
    
    if [ -f "/lib/systemd/system/$SERVICE_NAME.service" ]; then
        sudo rm -f "/lib/systemd/system/$SERVICE_NAME.service"
        print_success "System service file removed"
    fi
    
    sudo systemctl daemon-reload
    sudo systemctl reset-failed 2>/dev/null || true
    
    print_success "Systemd configuration cleaned"
}

# ============================================
# REMOVE NGINX CONFIGURATION
# ============================================

remove_nginx_config() {
    print_step "Removing Nginx configuration..."
    
    NGINX_AVAILABLE="/etc/nginx/sites-available/$SERVICE_NAME"
    NGINX_ENABLED="/etc/nginx/sites-enabled/$SERVICE_NAME"
    
    if [ -f "$NGINX_AVAILABLE" ]; then
        sudo rm -f "$NGINX_AVAILABLE"
        print_success "Nginx config removed from sites-available"
    fi
    
    if [ -L "$NGINX_ENABLED" ] || [ -f "$NGINX_ENABLED" ]; then
        sudo rm -f "$NGINX_ENABLED"
        print_success "Nginx config removed from sites-enabled"
    fi
    
    # Test and reload nginx if it exists
    if command -v nginx &> /dev/null; then
        sudo nginx -t 2>/dev/null && sudo systemctl reload nginx 2>/dev/null
        print_success "Nginx reloaded"
    fi
}

# ============================================
# REMOVE SSL CERTIFICATES (Let's Encrypt)
# ============================================

remove_ssl_certificates() {
    print_step "Removing SSL certificates..."
    
    # Get domain from old .env if exists
    DOMAIN=""
    if [ -f "$INSTALL_DIR/.env" ]; then
        DOMAIN=$(grep "^DOMAIN=" "$INSTALL_DIR/.env" | cut -d'=' -f2 | tr -d '"' | tr -d "'")
    fi
    
    if [ -n "$DOMAIN" ] && command -v certbot &> /dev/null; then
        if confirm "Remove Let's Encrypt SSL certificate for $DOMAIN?"; then
            sudo certbot delete --cert-name "$DOMAIN" --non-interactive 2>/dev/null || true
            print_success "SSL certificate removed"
        fi
    fi
}

# ============================================
# REMOVE DIRECTORIES
# ============================================

remove_directories() {
    print_step "Removing directories and files..."
    
    # Remove installation directory
    if [ -d "$INSTALL_DIR" ]; then
        sudo rm -rf "$INSTALL_DIR"
        print_success "Removed: $INSTALL_DIR"
    fi
    
    # Remove data directory
    if [ -d "$DATA_DIR" ]; then
        sudo rm -rf "$DATA_DIR"
        print_success "Removed: $DATA_DIR"
    fi
    
    # Remove log directory
    if [ -d "$LOG_DIR" ]; then
        sudo rm -rf "$LOG_DIR"
        print_success "Removed: $LOG_DIR"
    fi
    
    # Remove config directory
    if [ -d "$CONFIG_DIR" ]; then
        sudo rm -rf "$CONFIG_DIR"
        print_success "Removed: $CONFIG_DIR"
    fi
}

# ============================================
# REMOVE PM2 PROCESS (if using PM2)
# ============================================

remove_pm2_process() {
    print_step "Checking for PM2 processes..."
    
    if command -v pm2 &> /dev/null; then
        if pm2 list | grep -q "$SERVICE_NAME"; then
            pm2 stop "$SERVICE_NAME" 2>/dev/null || true
            pm2 delete "$SERVICE_NAME" 2>/dev/null || true
            print_success "PM2 process removed"
        fi
    fi
}

# ============================================
# REMOVE DOCKER CONTAINER (if using Docker)
# ============================================

remove_docker() {
    print_step "Checking for Docker containers..."
    
    if command -v docker &> /dev/null; then
        if docker ps -a --format '{{.Names}}' | grep -q "^$SERVICE_NAME$"; then
            docker stop "$SERVICE_NAME" 2>/dev/null || true
            docker rm "$SERVICE_NAME" 2>/dev/null || true
            print_success "Docker container removed"
        fi
        
        if docker image ls --format '{{.Repository}}' | grep -q "^nullname"; then
            if confirm "Remove NullName DB Docker images?"; then
                docker rmi $(docker images nullname* -q) 2>/dev/null || true
                print_success "Docker images removed"
            fi
        fi
    fi
}

# ============================================
# CLEANUP USER (optional)
# ============================================

cleanup_user() {
    print_step "Cleanup user account?"
    
    NULLNAME_USER=$(whoami)
    
    if confirm "Remove NullName DB user '$NULLNAME_USER'? (Skip if user has other services)"; then
        # Don't actually delete the user, just warn
        print_warning "User not deleted automatically. To remove manually: sudo userdel $NULLNAME_USER"
    fi
}

# ============================================
# CLEANUP CRON JOBS
# ============================================

cleanup_cron() {
    print_step "Removing cron jobs..."
    
    if command -v crontab &> /dev/null; then
        crontab -l 2>/dev/null | grep -v "nullname" | crontab - 2>/dev/null || true
        print_success "Cron jobs cleaned"
    fi
}

# ============================================
# PRINT UNINSTALL SUMMARY
# ============================================

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
        echo "  3. Restart the service"
        echo ""
    fi
    
    echo -e "${CYAN}Removed components:${NC}"
    echo "  ✓ Installation directory: $INSTALL_DIR"
    echo "  ✓ Data directory: $DATA_DIR"
    echo "  ✓ Log directory: $LOG_DIR"
    echo "  ✓ Systemd service: $SERVICE_NAME"
    echo "  ✓ Nginx configuration"
    echo "  ✓ SSL certificates (if configured)"
    echo "  ✓ Cron jobs"
    echo ""
    
    echo -e "${YELLOW}Manual cleanup (if needed):${NC}"
    echo "  • Remove npm global packages: npm uninstall -g nullname-db"
    echo "  • Remove user: sudo userdel $USER"
    echo "  • Remove backup: rm -rf $BACKUP_DIR"
    echo ""
    
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}   Thank you for using NullName DB${NC}"
    echo -e "${CYAN}   No brand. No name. No payment.${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
}

# ============================================
# MAIN UNINSTALL PROCESS
# ============================================

main() {
    print_header
    
    # Check if running as root (warn but continue)
    if [ "$EUID" -eq 0 ]; then
        print_warning "Running as root. Some operations may affect system files."
    fi
    
    # Confirm uninstallation
    print_warning "This will completely remove NullName DB and ALL its data!"
    confirm_delete
    
    # Run uninstallation steps
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
    cleanup_user
    
    print_summary
}

# Run main function
main "$@"
