
# NullName DB

## No brand. No name. No payment.

The simplest database in the universe. Zero configuration. Just works.

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/nullnamedb/system.git
cd system
chmod +x installment/install.sh
sudo ./installment/install.sh
```

After installation, open http://your-server:3000/dashboard

---

One Command Database

```bash
# Save data
curl http://localhost:3000/q?q=score=100

# Get data
curl http://localhost:3000/q?q=score
# Returns: 100

# Create database
curl http://localhost:3000/q?q=create.mydb

# Add data
curl http://localhost:3000/q?q=add.mydb.users.name.John

# Get all users
curl http://localhost:3000/q?q=get.mydb.users
```

---

Features

Feature Description
Zero Setup No installation, no configuration, just run
Simple Syntax q=key=value to save, q=key to get
No Email Username + password only
No Public Access Everything requires authentication
File Upload Built-in file storage
Version Control Git-like commits, branches, merge
Undo/Redo Fix mistakes instantly
Backup/Restore Automatic and manual backups
Multiple Formats JSON, CSV, Text, Table
Web Dashboard phpMyAdmin-style interface

---

API Reference

Authentication

```bash
# Signup
/q?q=signup.username.password

# Login (returns session key)
/q?q=login.username.password

# Use session in all queries
/q?q=get.users&ses=session_key
```

Data Operations

```bash
# Create database
/q?q=create.databasename

# Add record
/q?q=add.db.table.column.value

# Get all records
/q?q=get.db.table

# Get by ID
/q?q=get.db.table.id

# Update record
/q?q=update.db.table.id.column=value

# Delete record
/q?q=delete.db.table.id
```

Response Formats

```bash
# JSON (default)
/q?q=get.users&format=json

# Plain text
/q?q=get.users&format=text

# ASCII table
/q?q=get.users&format=table

# CSV
/q?q=get.users&format=csv
```

Version Control

```bash
# Create commit
/q?q=commit "message"

# View history
/q?q=commits

# Create branch
/q?q=branch.name

# Merge branch
/q?q=merge.source.into.target

# Undo last change
/q?q=undo

# Force recovery (admin only)
/f1?ses=admin_session
/f2?ses=admin_session
/f3?ses=admin_session
```

File Upload

```bash
# Upload from URL
/q?q=add.db.table.column=https://image.jpg.upload

# List files
/q?q=files.list

# Delete file
/q?q=files.delete.filename.jpg
```

---

Directory Structure

```
/opt/nullname/
├── server.js          # Main server
├── queries.js         # Query processor
├── auth.js            # Authentication
├── user.js            # User management
├── internet.js        # Network handler
├── core/              # Core modules
│   ├── database.js    # Database engine
│   ├── commit.js      # Version control
│   ├── backup.js      # Backup system
│   ├── track.js       # Tracking system
│   ├── admin.js       # Admin system
│   └── system.js      # Core system
├── ui/                # Web interface
├── docs/              # Documentation
└── database/          # Data storage (blocked)
```

---

Service Management

```bash
# Start service
sudo systemctl start nullname

# Stop service
sudo systemctl stop nullname

# Restart service
sudo systemctl restart nullname

# Check status
sudo systemctl status nullname

# View logs
sudo journalctl -u nullname -f
```

---

Configuration

Edit /opt/nullname/.env:

```env
PORT=3000
DOMAIN=localhost
ADMIN_USER=admin
ADMIN_PASS=your_password
ENABLE_SSL=false
MAX_FILE_SIZE_MB=50
BACKUP_INTERVAL_HOURS=24
```

Run configuration tool:

```bash
sudo bash /opt/nullname/installment/config.sh
```

---

Security

· No public read access
· All operations require authentication
· Database directory is blocked from direct access
· Passwords hashed with bcrypt
· Session-based authentication
· Rate limiting enabled
· IP blacklist/whitelist support

---

Uninstall

```bash
sudo bash /opt/nullname/uninstall.sh
```

---

License

MIT License - Free forever

---

Links

· GitHub
· Documentation
· API Reference

---

NullName DB — No brand. No name. No payment.
