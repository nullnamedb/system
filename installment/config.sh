#!/bin/bash
# ============================================
# NullName DB - Configuration Script
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
MAGENTA='\033[0;35m'
NC='\033[0m'
BOLD='\033[1m'

# ============================================
# CONFIGURATION
# ============================================

INSTALL_DIR="/opt/nullname"
CONFIG_FILE="$INSTALL_DIR/.env"
SERVICE_NAME="nullname"

# ============================================
# UTILITY FUNCTIONS
# ============================================

print_header() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}   NullName DB Configuration Tool${NC}"
    echo -e "${CYAN}========================================${NC}"
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

print_value() {
    echo -e "  ${CYAN}${1}:${NC} ${2}"
}

confirm() {
    read -p "$1 (y/N): " -n 1 -r
    echo ""
    [[ $REPLY =~ ^[Yy]$ ]]
}

# ============================================
# CHECK INSTALLATION
# ============================================

check_installation() {
    print_step "Checking installation..."
    
    if [ ! -f "$CONFIG_FILE" ]; then
        print_error "NullName DB not found or not properly installed at $INSTALL_DIR"
        echo ""
        echo "Please run install.sh first."
        exit 1
    fi
    
    print_success "Found NullName DB installation at $INSTALL_DIR"
}

# ============================================
# LOAD CURRENT CONFIGURATION
# ============================================

load_current_config() {
    print_step "Loading current configuration..."
    
    if [ -f "$CONFIG_FILE" ]; then
        source "$CONFIG_FILE"
        
        echo ""
        print_info "Current Configuration:"
        echo "  ┌─────────────────────────────────────────────"
        print_value "Port" "${PORT:-not set}"
        print_value "Domain" "${DOMAIN:-not set}"
        print_value "Admin User" "${ADMIN_USER:-not set}"
        print_value "SSL Enabled" "${ENABLE_SSL:-false}"
        print_value "Max File Size" "${MAX_FILE_SIZE_MB:-50} MB"
        print_value "Session Timeout" "$((${SESSION_TIMEOUT:-86400000} / 3600000)) hours"
        print_value "Backup Interval" "${BACKUP_INTERVAL_HOURS:-24} hours"
        print_value "Max Backups" "${MAX_BACKUPS_KEEP:-10}"
        print_value "Log Level" "${LOG_LEVEL:-info}"
        print_value "Max Storage" "${MAX_STORAGE_MB:-1024} MB"
        print_value "Auto Cleanup Days" "${AUTO_CLEANUP_DAYS:-30}"
        echo "  └─────────────────────────────────────────────"
    fi
}

# ============================================
# BACKUP CONFIGURATION
# ============================================

backup_config() {
    print_step "Backing up current configuration..."
    
    BACKUP_FILE="$CONFIG_FILE.backup_$(date +%Y%m%d_%H%M%S)"
    cp "$CONFIG_FILE" "$BACKUP_FILE"
    print_success "Backup saved to: $BACKUP_FILE"
}

# ============================================
# CONFIGURE PORT
# ============================================

configure_port() {
    print_step "Configure Port"
    
    CURRENT_PORT="${PORT:-3000}"
    echo -e "Current port: ${CYAN}${CURRENT_PORT}${NC}"
    read -p "Enter new port (press Enter to keep current): " NEW_PORT
    
    if [ -n "$NEW_PORT" ]; then
        if [[ "$NEW_PORT" =~ ^[0-9]+$ ]] && [ "$NEW_PORT" -ge 1 ] && [ "$NEW_PORT" -le 65535 ]; then
            sed -i "s/^PORT=.*/PORT=$NEW_PORT/" "$CONFIG_FILE"
            print_success "Port updated to: $NEW_PORT"
        else
            print_error "Invalid port number. Must be between 1 and 65535."
        fi
    else
        print_info "Port unchanged: $CURRENT_PORT"
    fi
}

# ============================================
# CONFIGURE DOMAIN
# ============================================

configure_domain() {
    print_step "Configure Domain"
    
    CURRENT_DOMAIN="${DOMAIN:-localhost}"
    echo -e "Current domain: ${CYAN}${CURRENT_DOMAIN}${NC}"
    read -p "Enter new domain (press Enter to keep current): " NEW_DOMAIN
    
    if [ -n "$NEW_DOMAIN" ]; then
        sed -i "s/^DOMAIN=.*/DOMAIN=$NEW_DOMAIN/" "$CONFIG_FILE"
        print_success "Domain updated to: $NEW_DOMAIN"
    else
        print_info "Domain unchanged: $CURRENT_DOMAIN"
    fi
}

# ============================================
# CONFIGURE ADMIN PASSWORD
# ============================================

configure_admin_password() {
    print_step "Configure Admin Password"
    
    echo -e "Current admin user: ${CYAN}${ADMIN_USER:-admin}${NC}"
    read -p "Enter new admin password (press Enter to skip): " NEW_PASS
    
    if [ -n "$NEW_PASS" ]; then
        if [ ${#NEW_PASS} -lt 4 ]; then
            print_error "Password must be at least 4 characters"
            return
        fi
        
        sed -i "s/^ADMIN_PASS=.*/ADMIN_PASS=$NEW_PASS/" "$CONFIG_FILE"
        print_success "Admin password updated"
        print_warning "Please restart the service for changes to take effect"
    else
        print_info "Password unchanged"
    fi
}

# ============================================
# CONFIGURE SSL
# ============================================

configure_ssl() {
    print_step "Configure SSL/HTTPS"
    
    CURRENT_SSL="${ENABLE_SSL:-false}"
    echo -e "Current SSL enabled: ${CYAN}${CURRENT_SSL}${NC}"
    
    read -p "Enable SSL? (y/n): " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sed -i "s/^ENABLE_SSL=.*/ENABLE_SSL=true/" "$CONFIG_FILE"
        
        read -p "Enter SSL certificate path: " CERT_PATH
        if [ -n "$CERT_PATH" ]; then
            sed -i "s|^SSL_CERT_PATH=.*|SSL_CERT_PATH=$CERT_PATH|" "$CONFIG_FILE"
        fi
        
        read -p "Enter SSL private key path: " KEY_PATH
        if [ -n "$KEY_PATH" ]; then
            sed -i "s|^SSL_KEY_PATH=.*|SSL_KEY_PATH=$KEY_PATH|" "$CONFIG_FILE"
        fi
        
        print_success "SSL enabled"
    else
        sed -i "s/^ENABLE_SSL=.*/ENABLE_SSL=false/" "$CONFIG_FILE"
        print_info "SSL disabled"
    fi
}

# ============================================
# CONFIGURE FILE SETTINGS
# ============================================

configure_file_settings() {
    print_step "Configure File Settings"
    
    CURRENT_MAX_SIZE="${MAX_FILE_SIZE_MB:-50}"
    echo -e "Current max file size: ${CYAN}${CURRENT_MAX_SIZE} MB${NC}"
    read -p "Enter new max file size in MB (press Enter to keep): " NEW_MAX_SIZE
    
    if [ -n "$NEW_MAX_SIZE" ] && [[ "$NEW_MAX_SIZE" =~ ^[0-9]+$ ]]; then
        sed -i "s/^MAX_FILE_SIZE_MB=.*/MAX_FILE_SIZE_MB=$NEW_MAX_SIZE/" "$CONFIG_FILE"
        print_success "Max file size updated to: $NEW_MAX_SIZE MB"
    else
        print_info "Max file size unchanged: $CURRENT_MAX_SIZE MB"
    fi
}

# ============================================
# CONFIGURE SESSION TIMEOUT
# ============================================

configure_session_timeout() {
    print_step "Configure Session Timeout"
    
    CURRENT_TIMEOUT_HOURS=$((${SESSION_TIMEOUT:-86400000} / 3600000))
    echo -e "Current session timeout: ${CYAN}${CURRENT_TIMEOUT_HOURS} hours${NC}"
    read -p "Enter new timeout in hours (press Enter to keep): " NEW_TIMEOUT_HOURS
    
    if [ -n "$NEW_TIMEOUT_HOURS" ] && [[ "$NEW_TIMEOUT_HOURS" =~ ^[0-9]+$ ]]; then
        NEW_TIMEOUT_MS=$((NEW_TIMEOUT_HOURS * 3600000))
        sed -i "s/^SESSION_TIMEOUT=.*/SESSION_TIMEOUT=$NEW_TIMEOUT_MS/" "$CONFIG_FILE"
        print_success "Session timeout updated to: $NEW_TIMEOUT_HOURS hours"
    else
        print_info "Session timeout unchanged: $CURRENT_TIMEOUT_HOURS hours"
    fi
}

# ============================================
# CONFIGURE BACKUP
# ============================================

configure_backup() {
    print_step "Configure Backup Settings"
    
    CURRENT_BACKUP_INTERVAL="${BACKUP_INTERVAL_HOURS:-24}"
    echo -e "Current backup interval: ${CYAN}${CURRENT_BACKUP_INTERVAL} hours${NC}"
    read -p "Enter new backup interval in hours (0 to disable, press Enter to keep): " NEW_INTERVAL
    
    if [ -n "$NEW_INTERVAL" ] && [[ "$NEW_INTERVAL" =~ ^[0-9]+$ ]]; then
        sed -i "s/^BACKUP_INTERVAL_HOURS=.*/BACKUP_INTERVAL_HOURS=$NEW_INTERVAL/" "$CONFIG_FILE"
        if [ "$NEW_INTERVAL" -eq 0 ]; then
            print_info "Auto-backup disabled"
        else
            print_success "Backup interval updated to: $NEW_INTERVAL hours"
        fi
    else
        print_info "Backup interval unchanged: $CURRENT_BACKUP_INTERVAL hours"
    fi
    
    CURRENT_MAX_BACKUPS="${MAX_BACKUPS_KEEP:-10}"
    echo -e "Current max backups to keep: ${CYAN}${CURRENT_MAX_BACKUPS}${NC}"
    read -p "Enter new max backups count (press Enter to keep): " NEW_MAX_BACKUPS
    
    if [ -n "$NEW_MAX_BACKUPS" ] && [[ "$NEW_MAX_BACKUPS" =~ ^[0-9]+$ ]]; then
        sed -i "s/^MAX_BACKUPS_KEEP=.*/MAX_BACKUPS_KEEP=$NEW_MAX_BACKUPS/" "$CONFIG_FILE"
        print_success "Max backups updated to: $NEW_MAX_BACKUPS"
    fi
}

# ============================================
# CONFIGURE LOGGING
# ============================================

configure_logging() {
    print_step "Configure Logging"
    
    CURRENT_LOG_LEVEL="${LOG_LEVEL:-info}"
    echo -e "Current log level: ${CYAN}${CURRENT_LOG_LEVEL}${NC}"
    echo "Available levels: debug, info, warn, error"
    read -p "Enter new log level (press Enter to keep): " NEW_LOG_LEVEL
    
    if [ -n "$NEW_LOG_LEVEL" ]; then
        case "$NEW_LOG_LEVEL" in
            debug|info|warn|error)
                sed -i "s/^LOG_LEVEL=.*/LOG_LEVEL=$NEW_LOG_LEVEL/" "$CONFIG_FILE"
                print_success "Log level updated to: $NEW_LOG_LEVEL"
                ;;
            *)
                print_error "Invalid log level. Must be: debug, info, warn, error"
                ;;
        esac
    else
        print_info "Log level unchanged: $CURRENT_LOG_LEVEL"
    fi
}

# ============================================
# CONFIGURE STORAGE
# ============================================

configure_storage() {
    print_step "Configure Storage Limits"
    
    CURRENT_MAX_STORAGE="${MAX_STORAGE_MB:-1024}"
    echo -e "Current max storage: ${CYAN}${CURRENT_MAX_STORAGE} MB${NC}"
    read -p "Enter new max storage in MB (press Enter to keep): " NEW_MAX_STORAGE
    
    if [ -n "$NEW_MAX_STORAGE" ] && [[ "$NEW_MAX_STORAGE" =~ ^[0-9]+$ ]]; then
        sed -i "s/^MAX_STORAGE_MB=.*/MAX_STORAGE_MB=$NEW_MAX_STORAGE/" "$CONFIG_FILE"
        print_success "Max storage updated to: $NEW_MAX_STORAGE MB"
    fi
    
    CURRENT_CLEANUP_DAYS="${AUTO_CLEANUP_DAYS:-30}"
    echo -e "Current auto cleanup days: ${CYAN}${CURRENT_CLEANUP_DAYS} days${NC}"
    read -p "Enter new cleanup days (0 to disable, press Enter to keep): " NEW_CLEANUP_DAYS
    
    if [ -n "$NEW_CLEANUP_DAYS" ] && [[ "$NEW_CLEANUP_DAYS" =~ ^[0-9]+$ ]]; then
        sed -i "s/^AUTO_CLEANUP_DAYS=.*/AUTO_CLEANUP_DAYS=$NEW_CLEANUP_DAYS/" "$CONFIG_FILE"
        if [ "$NEW_CLEANUP_DAYS" -eq 0 ]; then
            print_info "Auto cleanup disabled"
        else
            print_success "Auto cleanup days updated to: $NEW_CLEANUP_DAYS"
        fi
    fi
}

# ============================================
# CONFIGURE FEATURE FLAGS
# ============================================

configure_features() {
    print_step "Configure Feature Flags"
    
    echo ""
    echo "Toggle features (y/n):"
    echo ""
    
    # User signup
    CURRENT_SIGNUP="${ENABLE_SIGNUP:-true}"
    echo -e "  User signup: ${CYAN}${CURRENT_SIGNUP}${NC}"
    read -p "  Allow new user signups? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sed -i "s/^ENABLE_SIGNUP=.*/ENABLE_SIGNUP=true/" "$CONFIG_FILE"
        print_success "  User signup enabled"
    elif [[ $REPLY =~ ^[Nn]$ ]]; then
        sed -i "s/^ENABLE_SIGNUP=.*/ENABLE_SIGNUP=false/" "$CONFIG_FILE"
        print_info "  User signup disabled"
    fi
    
    # Public read
    CURRENT_PUBLIC="${ENABLE_PUBLIC_READ:-true}"
    echo -e "  Public read access: ${CYAN}${CURRENT_PUBLIC}${NC}"
    read -p "  Allow public read access? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sed -i "s/^ENABLE_PUBLIC_READ=.*/ENABLE_PUBLIC_READ=true/" "$CONFIG_FILE"
        print_success "  Public read enabled"
    elif [[ $REPLY =~ ^[Nn]$ ]]; then
        sed -i "s/^ENABLE_PUBLIC_READ=.*/ENABLE_PUBLIC_READ=false/" "$CONFIG_FILE"
        print_info "  Public read disabled"
    fi
    
    # File uploads
    CURRENT_FILES="${ENABLE_FILE_UPLOADS:-true}"
    echo -e "  File uploads: ${CYAN}${CURRENT_FILES}${NC}"
    read -p "  Allow file uploads? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sed -i "s/^ENABLE_FILE_UPLOADS=.*/ENABLE_FILE_UPLOADS=true/" "$CONFIG_FILE"
        print_success "  File uploads enabled"
    elif [[ $REPLY =~ ^[Nn]$ ]]; then
        sed -i "s/^ENABLE_FILE_UPLOADS=.*/ENABLE_FILE_UPLOADS=false/" "$CONFIG_FILE"
        print_info "  File uploads disabled"
    fi
    
    # Version control
    CURRENT_VERSION="${ENABLE_VERSION_CONTROL:-true}"
    echo -e "  Version control: ${CYAN}${CURRENT_VERSION}${NC}"
    read -p "  Enable version control (commits, branches)? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sed -i "s/^ENABLE_VERSION_CONTROL=.*/ENABLE_VERSION_CONTROL=true/" "$CONFIG_FILE"
        print_success "  Version control enabled"
    elif [[ $REPLY =~ ^[Nn]$ ]]; then
        sed -i "s/^ENABLE_VERSION_CONTROL=.*/ENABLE_VERSION_CONTROL=false/" "$CONFIG_FILE"
        print_info "  Version control disabled"
    fi
}

# ============================================
# RESET CONFIGURATION
# ============================================

reset_config() {
    print_step "Reset Configuration to Defaults"
    
    echo -e "${RED}${BOLD}⚠ WARNING: This will reset ALL configuration to defaults!${NC}"
    if confirm "Are you sure you want to reset?"; then
        if confirm "This action cannot be undone. Continue?"; then
            # Create backup before reset
            backup_config
            
            cat > "$CONFIG_FILE" << 'EOF'
# ============================================
# NullName DB - Environment Configuration
# ============================================

# Server Configuration
PORT=3000
DOMAIN=localhost
NODE_ENV=production

# Admin User
ADMIN_USER=admin
ADMIN_PASS=nullname2025
ROOT_KEY=7f3a8e2b9c1d4f6a8e2b9c1d4f6a8e2b

# Security
SESSION_TIMEOUT=86400000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# SSL Configuration
ENABLE_SSL=false
SSL_CERT_PATH=
SSL_KEY_PATH=

# File Configuration
MAX_FILE_SIZE_MB=50
TEMP_FILE_CLEANUP_MS=3600000

# Backup Configuration
BACKUP_INTERVAL_HOURS=24
MAX_BACKUPS_KEEP=10
BACKUP_COMPRESSION=true

# Logging
LOG_LEVEL=info
ENABLE_REQUEST_LOG=true
ENABLE_QUERY_TRACKING=true

# Storage
MAX_STORAGE_MB=1024
AUTO_CLEANUP_DAYS=30

# Feature Flags
ENABLE_SIGNUP=true
ENABLE_PUBLIC_READ=true
ENABLE_FILE_UPLOADS=true
ENABLE_VERSION_CONTROL=true
ENABLE_BACKUP_SYSTEM=true
EOF
            print_success "Configuration reset to defaults"
            print_warning "Please restart the service for changes to take effect"
        fi
    fi
}

# ============================================
# VIEW CONFIGURATION
# ============================================

view_config() {
    print_step "Full Configuration"
    
    if [ -f "$CONFIG_FILE" ]; then
        echo ""
        echo -e "${CYAN}========================================${NC}"
        echo -e "${CYAN}Current Configuration File:${NC}"
        echo -e "${CYAN}========================================${NC}"
        echo ""
        cat "$CONFIG_FILE"
        echo ""
    else
        print_error "Configuration file not found"
    fi
}

# ============================================
# VALIDATE CONFIGURATION
# ============================================

validate_config() {
    print_step "Validating Configuration"
    
    VALID=true
    
    # Check port
    if [ -n "$PORT" ] && [[ ! "$PORT" =~ ^[0-9]+$ ]]; then
        print_error "Invalid PORT: $PORT (must be number)"
        VALID=false
    fi
    
    # Check admin user
    if [ -n "$ADMIN_USER" ] && [ ${#ADMIN_USER} -lt 3 ]; then
        print_error "Invalid ADMIN_USER: too short (min 3 characters)"
        VALID=false
    fi
    
    # Check admin password
    if [ -n "$ADMIN_PASS" ] && [ ${#ADMIN_PASS} -lt 4 ]; then
        print_error "Invalid ADMIN_PASS: too short (min 4 characters)"
        VALID=false
    fi
    
    # Check SSL paths if enabled
    if [ "${ENABLE_SSL:-false}" = "true" ]; then
        if [ -n "$SSL_CERT_PATH" ] && [ ! -f "$SSL_CERT_PATH" ]; then
            print_error "SSL certificate not found: $SSL_CERT_PATH"
            VALID=false
        fi
        if [ -n "$SSL_KEY_PATH" ] && [ ! -f "$SSL_KEY_PATH" ]; then
            print_error "SSL key not found: $SSL_KEY_PATH"
            VALID=false
        fi
    fi
    
    if [ "$VALID" = true ]; then
        print_success "Configuration is valid"
    else
        print_error "Configuration contains errors"
    fi
}

# ============================================
# APPLY CHANGES
# ============================================

apply_changes() {
    print_step "Apply Changes"
    
    if confirm "Restart NullName DB service to apply changes?"; then
        if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
            sudo systemctl restart "$SERVICE_NAME"
            print_success "Service restarted"
            
            sleep 2
            if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
                print_success "Service is running"
            else
                print_error "Service failed to start. Check logs: sudo journalctl -u $SERVICE_NAME -n 20"
            fi
        else
            print_warning "Service not running. Start with: sudo systemctl start $SERVICE_NAME"
        fi
    else
        print_info "Changes saved but not applied. Restart service manually to apply."
    fi
}

# ============================================
# SHOW MENU
# ============================================

show_menu() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}   Configuration Options${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    echo "  1) Change Port"
    echo "  2) Change Domain"
    echo "  3) Change Admin Password"
    echo "  4) Configure SSL/HTTPS"
    echo "  5) Configure File Settings"
    echo "  6) Configure Session Timeout"
    echo "  7) Configure Backup Settings"
    echo "  8) Configure Logging"
    echo "  9) Configure Storage Limits"
    echo " 10) Configure Feature Flags"
    echo " 11) View Full Configuration"
    echo " 12) Validate Configuration"
    echo " 13) Reset to Defaults"
    echo " 14) Apply Changes & Restart"
    echo "  0) Exit"
    echo ""
}

# ============================================
# MAIN CONFIGURATION LOOP
# ============================================

main() {
    print_header
    
    check_installation
    load_current_config
    
    while true; do
        show_menu
        read -p "Select option [0-14]: " OPTION
        
        case $OPTION in
            1) configure_port ;;
            2) configure_domain ;;
            3) configure_admin_password ;;
            4) configure_ssl ;;
            5) configure_file_settings ;;
            6) configure_session_timeout ;;
            7) configure_backup ;;
            8) configure_logging ;;
            9) configure_storage ;;
            10) configure_features ;;
            11) view_config ;;
            12) validate_config ;;
            13) reset_config ;;
            14) apply_changes ;;
            0) 
                print_info "Exiting configuration tool"
                exit 0
                ;;
            *)
                print_error "Invalid option. Please select 0-14"
                ;;
        esac
    done
}

# Run main function
main "$@"
