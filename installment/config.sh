#!/bin/bash
# ============================================
# NullName DB - Configuration Script
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
CONFIG_FILE="$INSTALL_DIR/.env"
SERVICE_NAME="nullname"

print_header() {
    echo ""
    echo -e "${CYAN}========================================${NC}"
    echo -e "${CYAN}   NullName DB Configuration Tool${NC}"
    echo -e "${CYAN}========================================${NC}"
    echo ""
}

print_success() { echo -e "${GREEN}✓${NC} $1"; }
print_error() { echo -e "${RED}✗${NC} $1"; }
print_info() { echo -e "${BLUE}ℹ${NC} $1"; }
print_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
print_step() { echo ""; echo -e "${BOLD}${CYAN}>>>${NC} ${BOLD}$1${NC}"; }
print_value() { echo -e "  ${CYAN}${1}:${NC} ${2}"; }
confirm() { read -p "$1 (y/N): " -n 1 -r; echo ""; [[ $REPLY =~ ^[Yy]$ ]]; }

check_installation() {
    print_step "Checking installation..."
    if [ ! -f "$CONFIG_FILE" ]; then
        print_error "NullName DB not found at $INSTALL_DIR"
        echo "Please run install.sh first."
        exit 1
    fi
    print_success "Found NullName DB at $INSTALL_DIR"
}

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
        echo "  └─────────────────────────────────────────────"
    fi
}

backup_config() {
    BACKUP_FILE="$CONFIG_FILE.backup_$(date +%Y%m%d_%H%M%S)"
    cp "$CONFIG_FILE" "$BACKUP_FILE"
    print_success "Backup saved to: $BACKUP_FILE"
}

configure_port() {
    print_step "Configure Port"
    CURRENT_PORT="${PORT:-3000}"
    echo -e "Current port: ${CYAN}${CURRENT_PORT}${NC}"
    read -p "Enter new port (Enter to keep): " NEW_PORT
    if [ -n "$NEW_PORT" ]; then
        if [[ "$NEW_PORT" =~ ^[0-9]+$ ]] && [ "$NEW_PORT" -ge 1 ] && [ "$NEW_PORT" -le 65535 ]; then
            sed -i "s/^PORT=.*/PORT=$NEW_PORT/" "$CONFIG_FILE"
            print_success "Port updated to: $NEW_PORT"
        else
            print_error "Invalid port"
        fi
    else
        print_info "Port unchanged: $CURRENT_PORT"
    fi
}

configure_domain() {
    print_step "Configure Domain"
    CURRENT_DOMAIN="${DOMAIN:-localhost}"
    echo -e "Current domain: ${CYAN}${CURRENT_DOMAIN}${NC}"
    read -p "Enter new domain (Enter to keep): " NEW_DOMAIN
    if [ -n "$NEW_DOMAIN" ]; then
        sed -i "s/^DOMAIN=.*/DOMAIN=$NEW_DOMAIN/" "$CONFIG_FILE"
        print_success "Domain updated to: $NEW_DOMAIN"
    else
        print_info "Domain unchanged: $CURRENT_DOMAIN"
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
        sed -i "s/^ADMIN_PASS=.*/ADMIN_PASS=$NEW_PASS/" "$CONFIG_FILE"
        print_success "Admin password updated"
        print_warning "Restart service for changes to take effect"
    else
        print_info "Password unchanged"
    fi
}

configure_ssl() {
    print_step "Configure SSL/HTTPS"
    CURRENT_SSL="${ENABLE_SSL:-false}"
    echo -e "Current SSL enabled: ${CYAN}${CURRENT_SSL}${NC}"
    read -p "Enable SSL? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sed -i "s/^ENABLE_SSL=.*/ENABLE_SSL=true/" "$CONFIG_FILE"
        read -p "SSL certificate path: " CERT_PATH
        [ -n "$CERT_PATH" ] && sed -i "s|^SSL_CERT_PATH=.*|SSL_CERT_PATH=$CERT_PATH|" "$CONFIG_FILE"
        read -p "SSL private key path: " KEY_PATH
        [ -n "$KEY_PATH" ] && sed -i "s|^SSL_KEY_PATH=.*|SSL_KEY_PATH=$KEY_PATH|" "$CONFIG_FILE"
        print_success "SSL enabled"
    else
        sed -i "s/^ENABLE_SSL=.*/ENABLE_SSL=false/" "$CONFIG_FILE"
        print_info "SSL disabled"
    fi
}

configure_file_settings() {
    print_step "Configure File Settings"
    CURRENT_SIZE="${MAX_FILE_SIZE_MB:-50}"
    echo -e "Current max file size: ${CYAN}${CURRENT_SIZE} MB${NC}"
    read -p "Enter new max file size MB (Enter to keep): " NEW_SIZE
    if [ -n "$NEW_SIZE" ] && [[ "$NEW_SIZE" =~ ^[0-9]+$ ]]; then
        sed -i "s/^MAX_FILE_SIZE_MB=.*/MAX_FILE_SIZE_MB=$NEW_SIZE/" "$CONFIG_FILE"
        print_success "Max file size: $NEW_SIZE MB"
    fi
}

configure_session_timeout() {
    print_step "Configure Session Timeout"
    CURRENT_HOURS=$((${SESSION_TIMEOUT:-86400000} / 3600000))
    echo -e "Current session timeout: ${CYAN}${CURRENT_HOURS} hours${NC}"
    read -p "Enter new timeout hours (Enter to keep): " NEW_HOURS
    if [ -n "$NEW_HOURS" ] && [[ "$NEW_HOURS" =~ ^[0-9]+$ ]]; then
        NEW_MS=$((NEW_HOURS * 3600000))
        sed -i "s/^SESSION_TIMEOUT=.*/SESSION_TIMEOUT=$NEW_MS/" "$CONFIG_FILE"
        print_success "Session timeout: $NEW_HOURS hours"
    fi
}

configure_backup() {
    print_step "Configure Backup Settings"
    CURRENT_INTERVAL="${BACKUP_INTERVAL_HOURS:-24}"
    echo -e "Current backup interval: ${CYAN}${CURRENT_INTERVAL} hours${NC}"
    read -p "Enter new interval hours (0=disable, Enter to keep): " NEW_INTERVAL
    if [ -n "$NEW_INTERVAL" ] && [[ "$NEW_INTERVAL" =~ ^[0-9]+$ ]]; then
        sed -i "s/^BACKUP_INTERVAL_HOURS=.*/BACKUP_INTERVAL_HOURS=$NEW_INTERVAL/" "$CONFIG_FILE"
        [ "$NEW_INTERVAL" -eq 0 ] && print_info "Auto-backup disabled" || print_success "Backup interval: $NEW_INTERVAL hours"
    fi
    CURRENT_MAX="${MAX_BACKUPS_KEEP:-10}"
    echo -e "Current max backups: ${CYAN}${CURRENT_MAX}${NC}"
    read -p "Enter new max backups (Enter to keep): " NEW_MAX
    if [ -n "$NEW_MAX" ] && [[ "$NEW_MAX" =~ ^[0-9]+$ ]]; then
        sed -i "s/^MAX_BACKUPS_KEEP=.*/MAX_BACKUPS_KEEP=$NEW_MAX/" "$CONFIG_FILE"
        print_success "Max backups: $NEW_MAX"
    fi
}

configure_logging() {
    print_step "Configure Logging"
    CURRENT_LEVEL="${LOG_LEVEL:-info}"
    echo -e "Current log level: ${CYAN}${CURRENT_LEVEL}${NC}"
    echo "Available: debug, info, warn, error"
    read -p "Enter new log level (Enter to keep): " NEW_LEVEL
    if [ -n "$NEW_LEVEL" ]; then
        case "$NEW_LEVEL" in
            debug|info|warn|error)
                sed -i "s/^LOG_LEVEL=.*/LOG_LEVEL=$NEW_LEVEL/" "$CONFIG_FILE"
                print_success "Log level: $NEW_LEVEL"
                ;;
            *) print_error "Invalid level"
        esac
    fi
}

configure_features() {
    print_step "Configure Features"
    CURRENT_SIGNUP="${ENABLE_SIGNUP:-true}"
    echo -e "User signup: ${CYAN}${CURRENT_SIGNUP}${NC}"
    read -p "Allow new user signups? (y/n): " -n 1 -r; echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then sed -i "s/^ENABLE_SIGNUP=.*/ENABLE_SIGNUP=true/" "$CONFIG_FILE"; print_success "Signup enabled"
    elif [[ $REPLY =~ ^[Nn]$ ]]; then sed -i "s/^ENABLE_SIGNUP=.*/ENABLE_SIGNUP=false/" "$CONFIG_FILE"; print_info "Signup disabled"; fi
}

reset_config() {
    print_step "Reset to Defaults"
    echo -e "${RED}⚠ WARNING: This will reset ALL configuration to defaults!${NC}"
    if confirm "Are you sure?"; then
        backup_config
        cat > "$CONFIG_FILE" << 'EOF'
PORT=3000
DOMAIN=localhost
NODE_ENV=production
ADMIN_USER=admin
ADMIN_PASS=nullname2025
ROOT_KEY=7f3a8e2b9c1d4f6a8e2b9c1d4f6a8e2b
SESSION_TIMEOUT=86400000
ENABLE_SSL=false
SSL_CERT_PATH=
SSL_KEY_PATH=
MAX_FILE_SIZE_MB=50
BACKUP_INTERVAL_HOURS=24
MAX_BACKUPS_KEEP=10
LOG_LEVEL=info
ENABLE_SIGNUP=true
ENABLE_PUBLIC_READ=false
ENABLE_FILE_UPLOADS=true
ENABLE_VERSION_CONTROL=true
ENABLE_BACKUP_SYSTEM=true
EOF
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
    [ -n "$PORT" ] && [[ ! "$PORT" =~ ^[0-9]+$ ]] && print_error "Invalid PORT" && VALID=false
    [ -n "$ADMIN_USER" ] && [ ${#ADMIN_USER} -lt 3 ] && print_error "ADMIN_USER too short" && VALID=false
    [ -n "$ADMIN_PASS" ] && [ ${#ADMIN_PASS} -lt 4 ] && print_error "ADMIN_PASS too short" && VALID=false
    if [ "${ENABLE_SSL:-false}" = "true" ]; then
        [ -n "$SSL_CERT_PATH" ] && [ ! -f "$SSL_CERT_PATH" ] && print_error "SSL cert not found: $SSL_CERT_PATH" && VALID=false
        [ -n "$SSL_KEY_PATH" ] && [ ! -f "$SSL_KEY_PATH" ] && print_error "SSL key not found: $SSL_KEY_PATH" && VALID=false
    fi
    [ "$VALID" = true ] && print_success "Configuration is valid" || print_error "Configuration has errors"
}

apply_changes() {
    print_step "Apply Changes"
    if confirm "Restart NullName DB service?"; then
        if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
            sudo systemctl restart "$SERVICE_NAME"
            print_success "Service restarted"
            sleep 2
            systemctl is-active --quiet "$SERVICE_NAME" && print_success "Service running" || print_error "Service failed. Check logs: sudo journalctl -u $SERVICE_NAME -n 20"
        else
            print_warning "Service not running. Start with: sudo systemctl start $SERVICE_NAME"
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
    echo "  1) Change Port"
    echo "  2) Change Domain"
    echo "  3) Change Admin Password"
    echo "  4) Configure SSL/HTTPS"
    echo "  5) Configure File Settings"
    echo "  6) Configure Session Timeout"
    echo "  7) Configure Backup Settings"
    echo "  8) Configure Logging"
    echo "  9) Configure Features"
    echo " 10) View Full Configuration"
    echo " 11) Validate Configuration"
    echo " 12) Reset to Defaults"
    echo " 13) Apply Changes & Restart"
    echo "  0) Exit"
    echo ""
}

main() {
    print_header
    check_installation
    load_current_config
    while true; do
        show_menu
        read -p "Select option [0-13]: " OPTION
        case $OPTION in
            1) configure_port ;;
            2) configure_domain ;;
            3) configure_admin_password ;;
            4) configure_ssl ;;
            5) configure_file_settings ;;
            6) configure_session_timeout ;;
            7) configure_backup ;;
            8) configure_logging ;;
            9) configure_features ;;
            10) view_config ;;
            11) validate_config ;;
            12) reset_config ;;
            13) apply_changes ;;
            0) print_info "Exiting"; exit 0 ;;
            *) print_error "Invalid option" ;;
        esac
    done
}

main "$@"