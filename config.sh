#!/bin/bash
# ============================================
# NullName DB - Configuration Script
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

# Paths
INSTALL_DIR="/opt/nullname"
CONFIG_FILE="$INSTALL_DIR/.env"
SERVICE_NAME="nullname"

# ============================================
# UTILITY FUNCTIONS
# ============================================

print_header() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║                                                              ║${NC}"
    echo -e "${CYAN}║   NullName DB Configuration Tool                             ║${NC}"
    echo -e "${CYAN}║   No brand. No name. No payment.                             ║${NC}"
    echo -e "${CYAN}║                                                              ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_info() { echo -e "${BLUE}ℹ${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_step() { echo ""; echo -e "${BOLD}${CYAN}>>>${NC} ${BOLD}$1${NC}"; }
print_value() { echo -e "  ${CYAN}${1}:${NC} ${2}"; }

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
        print_error "NullName DB not found at $INSTALL_DIR"
        echo "Please run install.sh first."
        exit 1
    fi
    
    print_success "Found NullName DB at $INSTALL_DIR"
}

# ============================================
# LOAD/SAVE CONFIG
# ============================================

load_current_config() {
    print_step "Loading current configuration..."
    
    if [ -f "$CONFIG_FILE" ]; then
        # Source the config file safely
        set -a
        source "$CONFIG_FILE"
        set +a
        
        echo ""
        print_info "Current Configuration:"
        echo "  ┌─────────────────────────────────────────────"
        print_value "Port" "${PORT:-not set}"
        print_value "Domain" "${DOMAIN:-not set}"
        print_value "Admin User" "${ADMIN_USER:-not set}"
        print_value "SSL Enabled" "${ENABLE_SSL:-false}"
        print_value "Max File Size" "${MAX_FILE_SIZE_MB:-50} MB"
        print_value "Session Timeout" "$(( ${SESSION_TIMEOUT:-86400000} / 3600000 )) hours"
        print_value "Backup Enabled" "${ENABLE_BACKUP:-true}"
        [ "${ENABLE_BACKUP:-true}" = "true" ] && print_value "Backup Interval" "${BACKUP_INTERVAL_HOURS:-24} hours"
        print_value "Max Backups" "${MAX_BACKUPS_KEEP:-10}"
        print_value "Log Level" "${LOG_LEVEL:-info}"
        print_value "Rate Limit" "${RATE_LIMIT_MAX:-1000} requests per ${RATE_LIMIT_WINDOW_MS:-900000}ms"
        echo "  └─────────────────────────────────────────────"
    fi
}

backup_config() {
    BACKUP_FILE="$CONFIG_FILE.backup_$(date +%Y%m%d_%H%M%S)"
    cp "$CONFIG_FILE" "$BACKUP_FILE"
    print_success "Backup saved to: $BACKUP_FILE"
}

save_config() {
    # Write all variables back to .env file
    cat > "$CONFIG_FILE" << EOF
# NullName DB Environment Configuration
# Generated: $(date)

# Server
PORT=$PORT
DOMAIN=$DOMAIN
NODE_ENV=${NODE_ENV:-production}

# Authentication
ADMIN_USER=$ADMIN_USER
ADMIN_PASS=$ADMIN_PASS
ROOT_KEY=${ROOT_KEY:-$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-f0-9' | fold -w 64 | head -n 1)}
SESSION_SECRET=${SESSION_SECRET:-$(openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-f0-9' | fold -w 64 | head -n 1)}
SESSION_TIMEOUT=$SESSION_TIMEOUT

# SSL/TLS
ENABLE_SSL=$ENABLE_SSL
SSL_CERT_PATH=$SSL_CERT_PATH
SSL_KEY_PATH=$SSL_KEY_PATH

# Storage
MAX_FILE_SIZE_MB=$MAX_FILE_SIZE_MB
MAX_STORAGE_MB=$MAX_STORAGE_MB
TEMP_FILE_CLEANUP_MS=$TEMP_FILE_CLEANUP_MS

# Backup
ENABLE_BACKUP=$ENABLE_BACKUP
BACKUP_INTERVAL_HOURS=$BACKUP_INTERVAL_HOURS
MAX_BACKUPS_KEEP=$MAX_BACKUPS_KEEP

# Logging
LOG_LEVEL=$LOG_LEVEL
SLOW_QUERY_MS=$SLOW_QUERY_MS

# Features
ENABLE_SIGNUP=$ENABLE_SIGNUP
ENABLE_PUBLIC_READ=$ENABLE_PUBLIC_READ
ENABLE_FILE_UPLOADS=$ENABLE_FILE_UPLOADS
ENABLE_VERSION_CONTROL=$ENABLE_VERSION_CONTROL
ENABLE_REALTIME=$ENABLE_REALTIME
ENABLE_SQL=$ENABLE_SQL
ENABLE_NOSQL=$ENABLE_NOSQL
ENABLE_FILEBASE=$ENABLE_FILEBASE

# Rate Limiting
RATE_LIMIT_MAX=$RATE_LIMIT_MAX
RATE_LIMIT_WINDOW_MS=$RATE_LIMIT_WINDOW_MS
EOF
    print_success "Configuration saved"
}

# ============================================
# CONFIGURATION MENU
# ============================================

configure_port() {
    print_step "Configure Port"
    echo -e "Current port: ${CYAN}${PORT:-3000}${NC}"
    read -p "Enter new port (Enter to keep): " NEW_PORT
    
    if [ -n "$NEW_PORT" ]; then
        if [[ "$NEW_PORT" =~ ^[0-9]+$ ]] && [ "$NEW_PORT" -ge 1 ] && [ "$NEW_PORT" -le 65535 ]; then
            PORT="$NEW_PORT"
            print_success "Port updated to: $PORT"
        else
            print_error "Invalid port (must be 1-65535)"
        fi
    else
        print_info "Port unchanged: ${PORT:-3000}"
    fi
}

configure_domain() {
    print_step "Configure Domain"
    echo -e "Current domain: ${CYAN}${DOMAIN:-localhost}${NC}"
    read -p "Enter new domain (Enter to keep): " NEW_DOMAIN
    
    if [ -n "$NEW_DOMAIN" ]; then
        DOMAIN="$NEW_DOMAIN"
        print_success "Domain updated to: $DOMAIN"
    else
        print_info "Domain unchanged: ${DOMAIN:-localhost}"
    fi
}

configure_admin_password() {
    print_step "Configure Admin Password"
    echo -e "Current admin user: ${CYAN}${ADMIN_USER:-admin}${NC}"
    read -p "Enter new admin password (Enter to skip): " NEW_PASS
    
    if [ -n "$NEW_PASS" ]; then
        if [ ${#NEW_PASS} -lt 4 ]; then
            print_error "Password must be at least 4 characters"
            return
        fi
        ADMIN_PASS="$NEW_PASS"
        print_success "Admin password updated"
        print_warning "Restart service for changes to take effect"
    else
        print_info "Password unchanged"
    fi
}

configure_ssl() {
    print_step "Configure SSL/HTTPS"
    echo -e "Current SSL enabled: ${CYAN}${ENABLE_SSL:-false}${NC}"
    
    read -p "Enable SSL? (y/n): " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ENABLE_SSL="true"
        
        read -p "SSL certificate path: " CERT_PATH
        if [ -n "$CERT_PATH" ]; then
            SSL_CERT_PATH="$CERT_PATH"
        fi
        
        read -p "SSL private key path: " KEY_PATH
        if [ -n "$KEY_PATH" ]; then
            SSL_KEY_PATH="$KEY_PATH"
        fi
        
        print_success "SSL enabled"
    else
        ENABLE_SSL="false"
        SSL_CERT_PATH=""
        SSL_KEY_PATH=""
        print_info "SSL disabled"
    fi
}

configure_file_settings() {
    print_step "Configure File Settings"
    
    echo -e "Current max file size: ${CYAN}${MAX_FILE_SIZE_MB:-50} MB${NC}"
    read -p "Enter new max file size MB (Enter to keep): " NEW_SIZE
    if [ -n "$NEW_SIZE" ] && [[ "$NEW_SIZE" =~ ^[0-9]+$ ]]; then
        MAX_FILE_SIZE_MB="$NEW_SIZE"
        print_success "Max file size: $MAX_FILE_SIZE_MB MB"
    fi
    
    echo -e "Current max storage: ${CYAN}${MAX_STORAGE_MB:-10240} MB${NC}"
    read -p "Enter new max storage MB (Enter to keep): " NEW_MAX_STORAGE
    if [ -n "$NEW_MAX_STORAGE" ] && [[ "$NEW_MAX_STORAGE" =~ ^[0-9]+$ ]]; then
        MAX_STORAGE_MB="$NEW_MAX_STORAGE"
        print_success "Max storage: $MAX_STORAGE_MB MB"
    fi
}

configure_session() {
    print_step "Configure Session"
    
    CURRENT_HOURS=$(( ${SESSION_TIMEOUT:-86400000} / 3600000 ))
    echo -e "Current session timeout: ${CYAN}${CURRENT_HOURS} hours${NC}"
    read -p "Enter new timeout hours (Enter to keep): " NEW_HOURS
    
    if [ -n "$NEW_HOURS" ] && [[ "$NEW_HOURS" =~ ^[0-9]+$ ]]; then
        SESSION_TIMEOUT=$((NEW_HOURS * 3600000))
        print_success "Session timeout: $NEW_HOURS hours"
    fi
}

configure_backup() {
    print_step "Configure Backup"
    
    echo -e "Current backup enabled: ${CYAN}${ENABLE_BACKUP:-true}${NC}"
    read -p "Enable automatic backups? (y/n): " -n 1 -r
    echo ""
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ENABLE_BACKUP="true"
        
        echo -e "Current backup interval: ${CYAN}${BACKUP_INTERVAL_HOURS:-24} hours${NC}"
        read -p "Enter new interval hours (Enter to keep): " NEW_INTERVAL
        if [ -n "$NEW_INTERVAL" ] && [[ "$NEW_INTERVAL" =~ ^[0-9]+$ ]]; then
            BACKUP_INTERVAL_HOURS="$NEW_INTERVAL"
            print_success "Backup interval: $BACKUP_INTERVAL_HOURS hours"
        fi
        
        echo -e "Current max backups: ${CYAN}${MAX_BACKUPS_KEEP:-10}${NC}"
        read -p "Enter new max backups (Enter to keep): " NEW_MAX
        if [ -n "$NEW_MAX" ] && [[ "$NEW_MAX" =~ ^[0-9]+$ ]]; then
            MAX_BACKUPS_KEEP="$NEW_MAX"
            print_success "Max backups: $MAX_BACKUPS_KEEP"
        fi
    else
        ENABLE_BACKUP="false"
        BACKUP_INTERVAL_HOURS=0
        print_info "Auto-backup disabled"
    fi
}

configure_logging() {
    print_step "Configure Logging"
    
    echo -e "Current log level: ${CYAN}${LOG_LEVEL:-info}${NC}"
    echo "Available: debug, info, warn, error"
    read -p "Enter new log level (Enter to keep): " NEW_LEVEL
    
    if [ -n "$NEW_LEVEL" ]; then
        case "$NEW_LEVEL" in
            debug|info|warn|error)
                LOG_LEVEL="$NEW_LEVEL"
                print_success "Log level: $LOG_LEVEL"
                ;;
            *)
                print_error "Invalid level. Choose: debug, info, warn, error"
                ;;
        esac
    fi
    
    echo -e "Current slow query threshold: ${CYAN}${SLOW_QUERY_MS:-1000} ms${NC}"
    read -p "Enter new slow query threshold ms (Enter to keep): " NEW_SLOW
    if [ -n "$NEW_SLOW" ] && [[ "$NEW_SLOW" =~ ^[0-9]+$ ]]; then
        SLOW_QUERY_MS="$NEW_SLOW"
        print_success "Slow query threshold: $SLOW_QUERY_MS ms"
    fi
}

configure_features() {
    print_step "Configure Features"
    
    echo -e "User signup: ${CYAN}${ENABLE_SIGNUP:-true}${NC}"
    read -p "Allow new user signups? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ENABLE_SIGNUP="true"
        print_success "Signup enabled"
    elif [[ $REPLY =~ ^[Nn]$ ]]; then
        ENABLE_SIGNUP="false"
        print_info "Signup disabled"
    fi
    
    echo -e "File uploads: ${CYAN}${ENABLE_FILE_UPLOADS:-true}${NC}"
    read -p "Enable file uploads? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ENABLE_FILE_UPLOADS="true"
        print_success "File uploads enabled"
    elif [[ $REPLY =~ ^[Nn]$ ]]; then
        ENABLE_FILE_UPLOADS="false"
        print_info "File uploads disabled"
    fi
}

configure_rate_limit() {
    print_step "Configure Rate Limiting"
    
    echo -e "Current rate limit: ${CYAN}${RATE_LIMIT_MAX:-1000} requests per ${RATE_LIMIT_WINDOW_MS:-900000}ms${NC}"
    read -p "Enter max requests per window (Enter to keep): " NEW_MAX
    if [ -n "$NEW_MAX" ] && [[ "$NEW_MAX" =~ ^[0-9]+$ ]]; then
        RATE_LIMIT_MAX="$NEW_MAX"
        print_success "Max requests: $RATE_LIMIT_MAX"
    fi
    
    read -p "Enter window size in ms (Enter to keep): " NEW_WINDOW
    if [ -n "$NEW_WINDOW" ] && [[ "$NEW_WINDOW" =~ ^[0-9]+$ ]]; then
        RATE_LIMIT_WINDOW_MS="$NEW_WINDOW"
        print_success "Window: $RATE_LIMIT_WINDOW_MS ms"
    fi
}

configure_admin_user() {
    print_step "Configure Admin User"
    echo -e "Current admin user: ${CYAN}${ADMIN_USER:-admin}${NC}"
    read -p "Enter new admin username (Enter to keep): " NEW_USER
    
    if [ -n "$NEW_USER" ]; then
        if [ ${#NEW_USER} -lt 3 ]; then
            print_error "Username must be at least 3 characters"
            return
        fi
        ADMIN_USER="$NEW_USER"
        print_success "Admin username updated to: $ADMIN_USER"
    fi
}

reset_config() {
    print_step "Reset to Defaults"
    echo -e "${RED}⚠ WARNING: This will reset ALL configuration to defaults!${NC}"
    
    if confirm "Are you sure?"; then
        backup_config
        
        # Reset to defaults
        PORT="3000"
        DOMAIN="localhost"
        NODE_ENV="production"
        ADMIN_USER="admin"
        ADMIN_PASS="nullname2025"
        SESSION_TIMEOUT="86400000"
        ENABLE_SSL="false"
        SSL_CERT_PATH=""
        SSL_KEY_PATH=""
        MAX_FILE_SIZE_MB="50"
        MAX_STORAGE_MB="10240"
        TEMP_FILE_CLEANUP_MS="3600000"
        ENABLE_BACKUP="true"
        BACKUP_INTERVAL_HOURS="24"
        MAX_BACKUPS_KEEP="10"
        LOG_LEVEL="info"
        SLOW_QUERY_MS="1000"
        ENABLE_SIGNUP="true"
        ENABLE_PUBLIC_READ="false"
        ENABLE_FILE_UPLOADS="true"
        ENABLE_VERSION_CONTROL="true"
        ENABLE_REALTIME="true"
        ENABLE_SQL="true"
        ENABLE_NOSQL="true"
        ENABLE_FILEBASE="true"
        RATE_LIMIT_MAX="1000"
        RATE_LIMIT_WINDOW_MS="900000"
        
        save_config
        print_success "Reset to defaults"
        print_warning "Restart service to apply changes"
    fi
}

view_config() {
    print_step "Full Configuration"
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}Current Configuration:${NC}"
    echo -e "${CYAN}========================================${NC}"
    cat "$CONFIG_FILE"
}

validate_config() {
    print_step "Validating Configuration"
    
    VALID=true
    
    if [ -n "$PORT" ] && [[ ! "$PORT" =~ ^[0-9]+$ ]]; then
        print_error "Invalid PORT (must be number)"
        VALID=false
    fi
    
    if [ -n "$ADMIN_USER" ] && [ ${#ADMIN_USER} -lt 3 ]; then
        print_error "ADMIN_USER too short (min 3 characters)"
        VALID=false
    fi
    
    if [ -n "$ADMIN_PASS" ] && [ ${#ADMIN_PASS} -lt 4 ]; then
        print_error "ADMIN_PASS too short (min 4 characters)"
        VALID=false
    fi
    
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
    
    if [ -n "$MAX_FILE_SIZE_MB" ] && [[ ! "$MAX_FILE_SIZE_MB" =~ ^[0-9]+$ ]]; then
        print_error "MAX_FILE_SIZE_MB must be a number"
        VALID=false
    fi
    
    if [ "$VALID" = true ]; then
        print_success "Configuration is valid"
    else
        print_error "Configuration has errors"
    fi
}

apply_changes() {
    print_step "Apply Changes"
    
    save_config
    
    if confirm "Restart NullName DB service?"; then
        if command -v systemctl &> /dev/null && systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
            sudo systemctl restart "$SERVICE_NAME"
            print_success "Service restarted"
            
            sleep 2
            if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
                print_success "Service running"
            else
                print_error "Service failed to start. Check logs: sudo journalctl -u $SERVICE_NAME -n 20"
            fi
        elif command -v launchctl &> /dev/null && [ -f "$HOME/Library/LaunchAgents/com.nullname.db.plist" ]; then
            launchctl unload "$HOME/Library/LaunchAgents/com.nullname.db.plist" 2>/dev/null
            launchctl load "$HOME/Library/LaunchAgents/com.nullname.db.plist" 2>/dev/null
            print_success "Launchd service restarted"
        else
            print_warning "Service not managed. Please restart manually."
        fi
    else
        print_info "Changes saved. Restart service manually to apply."
    fi
}

show_menu() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}   Configuration Options${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
    echo "  1)  Change Port"
    echo "  2)  Change Domain"
    echo "  3)  Change Admin Password"
    echo "  4)  Change Admin Username"
    echo "  5)  Configure SSL/HTTPS"
    echo "  6)  Configure File Settings"
    echo "  7)  Configure Session Timeout"
    echo "  8)  Configure Backup Settings"
    echo "  9)  Configure Logging"
    echo " 10)  Configure Features"
    echo " 11)  Configure Rate Limiting"
    echo " 12)  View Full Configuration"
    echo " 13)  Validate Configuration"
    echo " 14)  Reset to Defaults"
    echo " 15)  Apply Changes & Restart"
    echo "  0)  Exit"
    echo ""
}

# ============================================
# MAIN
# ============================================

main() {
    print_header
    check_installation
    load_current_config
    
    while true; do
        show_menu
        read -p "Select option [0-15]: " OPTION
        
        case $OPTION in
            1) configure_port ;;
            2) configure_domain ;;
            3) configure_admin_password ;;
            4) configure_admin_user ;;
            5) configure_ssl ;;
            6) configure_file_settings ;;
            7) configure_session ;;
            8) configure_backup ;;
            9) configure_logging ;;
            10) configure_features ;;
            11) configure_rate_limit ;;
            12) view_config ;;
            13) validate_config ;;
            14) reset_config ;;
            15) apply_changes ;;
            0) print_info "Exiting"; exit 0 ;;
            *) print_error "Invalid option" ;;
        esac
    done
}

main "$@"
