# LisiLou Photography Portfolio

A lightweight, configurable photography portfolio website designed to integrate with Immich for image hosting and client gallery access.

## Features

- 🎨 **Elegant, modern design** - Clean photography-focused aesthetic
- ⚙️ **Easy configuration** - Update content via JSON files, no code changes needed
- 📱 **Fully responsive** - Looks great on all devices
- 🖼️ **Immich integration** - Direct links to shared albums for portfolio and client galleries
- 👥 **Multi-photographer support** - Configure multiple profiles for different photographers
- 🐳 **Docker ready** - Easy deployment with Docker and Docker Compose
- 🔄 **CI/CD ready** - Gitea Actions workflow included

## Quick Start

### Local Development

1. Clone this repository
2. Customize `config/site.json` with your information
3. Add your images to `public/images/`
4. Run with Docker:

```bash
docker compose up -d
```

5. Visit `http://localhost:8080`

### Configuration

All site content is configured through `config/site.json`. Here's what you can customize:

#### Site Settings
```json
{
  "site": {
    "title": "Your Photography Name",
    "tagline": "Your tagline here",
    "description": "SEO description"
  }
}
```

#### Social Media
```json
{
  "social": {
    "instagram": "your.handle",
    "facebook": "yourpage",
    "pinterest": "yourprofile",
    "tiktok": "yourhandle"
  }
}
```

#### Immich Integration
```json
{
  "immich": {
    "baseUrl": "https://photos.yourdomain.com",
    "publicAlbumPrefix": "/share/"
  }
}
```

#### Portfolio Categories
```json
{
  "portfolio": {
    "categories": [
      {
        "id": "seniors",
        "name": "Senior Portraits",
        "description": "Celebrate your milestone",
        "coverImage": "/images/portfolio/seniors-cover.jpg",
        "immichAlbumId": "your-immich-album-share-id"
      }
    ]
  }
}
```

#### Theme Customization
```json
{
  "theme": {
    "primaryColor": "#8B7355",
    "accentColor": "#D4C5B5",
    "textColor": "#2C2C2C",
    "backgroundColor": "#FDFBF9"
  }
}
```

### Adding Portfolio Images

1. Create cover images for each portfolio category
2. Place them in `public/images/portfolio/`
3. Update the `coverImage` paths in `config/site.json`
4. Get the share IDs from your Immich albums and add them to `immichAlbumId`

### Client Gallery Access

Clients can enter their gallery code (Immich share ID) on the website. They'll be redirected to their Immich shared album.

**Workflow:**
1. Create a shared album in Immich for your client
2. Give them the share ID as their "gallery code"
3. They enter it on your website and are taken directly to their photos

## Deployment

### With Docker Compose

1. Copy files to your server:
```bash
scp -r . user@server:/opt/lisilou-portfolio/
```

2. Create the external network:
```bash
docker network create web
```

3. Start the container:
```bash
cd /opt/lisilou-portfolio
docker compose up -d
```

### With Reverse Proxy (Traefik/Nginx)

If using Traefik, add labels to docker-compose.yml:

```yaml
services:
  portfolio:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.portfolio.rule=Host(`lisilou.com`)"
      - "traefik.http.routers.portfolio.tls=true"
      - "traefik.http.routers.portfolio.tls.certresolver=letsencrypt"
```

### Gitea Actions CI/CD

1. Set up Gitea Actions on your Gitea instance
2. Add these secrets to your repository:
   - `REGISTRY_USERNAME` - Container registry username
   - `REGISTRY_PASSWORD` - Container registry password
   - `DEPLOY_HOST` - Your server hostname
   - `DEPLOY_USER` - SSH username
   - `DEPLOY_KEY` - SSH private key

3. Update `.gitea/workflows/deploy.yml` with your registry URL

4. Push to main branch to trigger automatic deployment

## Multi-Photographer Support

To support multiple photographers:

1. Create additional config files (e.g., `config/photographer2.json`)
2. Update `config/profiles.json`:

```json
{
  "profiles": {
    "lisilou": {
      "enabled": true,
      "domain": "lisilou.com",
      "configFile": "site.json"
    },
    "photographer2": {
      "enabled": true,
      "domain": "photographer2.com",
      "configFile": "photographer2.json"
    }
  },
  "defaultProfile": "lisilou",
  "multiTenant": true
}
```

3. Add multi-tenant routing to nginx.conf (or use separate containers)

## File Structure

```
lisilou-portfolio/
├── config/
│   ├── site.json          # Main configuration
│   └── profiles.json      # Multi-profile config
├── public/
│   └── images/
│       ├── portfolio/     # Portfolio cover images
│       ├── logo.png       # Site logo
│       └── favicon.ico    # Favicon
├── src/
│   └── index.html         # Main HTML file
├── .gitea/
│   └── workflows/
│       └── deploy.yml     # CI/CD workflow
├── docker-compose.yml
├── Dockerfile
├── nginx.conf
└── README.md
```

## Updating Content

### To update text/settings:
1. Edit `config/site.json`
2. The changes are applied immediately (no rebuild needed)

### To update images:
1. Add new images to `public/images/`
2. Update paths in `config/site.json`
3. Changes are applied immediately

### To update code:
1. Edit `src/index.html`
2. Rebuild the Docker image:
```bash
docker compose build
docker compose up -d
```

Or push to Git and let CI/CD handle it.

## License

MIT License - Feel free to use and modify for your photography business!
