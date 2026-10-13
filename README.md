# Douglas Schoch — GIS & Cartography Portfolio

Modern geospatial portfolio and cartographic showcase built with **[Astro](https://astro.build/)**, **[Tailwind CSS](https://tailwindcss.com/)**, and **[Sveltia CMS](https://sveltiacms.app/)**, hosted on **GitHub Pages**.

---

## 🌟 Highlights & Key Features

- **WordPress-Style Web Admin (`/admin`)**: Edit your bio, create new projects, and upload map images directly from your browser—no manual code editing needed.
- **100% Free Hosting**: Automatically builds and deploys to GitHub Pages via GitHub Actions.
- **Preserved Interactive Web GIS**: Live Colorado Bustang GTFS-Realtime transit tracker hosted at `/bustang_leaflet/`.
- **High-Resolution Map Lightbox**: Allows visitors to inspect fine topographic and cartographic details.
- **Dark & Light Mode**: Accessible, persistent theme switching.

---

## 🛠️ How to Manage Content (The "WordPress" Experience)

### 1. Open the Admin Panel
Navigate to your site's admin URL:
```
https://schochdo.github.io/admin/
```

### 2. Log in with GitHub
- Click **Sign in with GitHub** (or enter a Personal Access Token with repo access).
- Once authenticated, you will see your visual dashboard.

### 3. Adding or Editing a Project
- Click **Portfolio Projects** -> **New Project** (or click an existing project to edit).
- Fill in:
  - **Title**: e.g., *Hiking Topo: Bighorn Crags, Idaho*
  - **Date**: Publication or creation date
  - **Tags / Categories**: e.g., *Cartography, Topography, USFS*
  - **Summary**: Brief description displayed on the homepage card
  - **Thumbnail Image**: Click to upload or select a map preview
  - **Hero / High-Res Map Image**: Full resolution map file
  - **Interactive Map URL**: (Optional) e.g., `/bustang_leaflet/` or external demo link
  - **Project Story (Markdown)**: Full case study or writeup
- Click **Publish**.

### 4. Automatic Deployment
When you click **Publish**, the CMS automatically creates a commit to your repository's `main` branch. GitHub Actions automatically builds the Astro site and updates the live site at `https://schochdo.github.io/` in under 60 seconds!

---

## 💻 Local Development

If you ever want to run or modify the code locally:

```bash
# Install dependencies
npm install

# Start local development server
npm run dev
```

Visit `http://localhost:4321` in your browser.

---

## 📁 Project Structure

```
├── .github/workflows/deploy.yml   # GitHub Actions automated deployment
├── public/
│   ├── admin/                     # Sveltia CMS visual editor (/admin)
│   ├── bustang_leaflet/           # Live interactive GTFS-RT Bustang tracker
│   ├── Leaflet.heat-gh-pages/     # Leaflet heat mapping library
│   └── images/                    # Map assets, thumbnails, avatars, uploads
├── src/
│   ├── components/                # Astro UI components (Hero, Navbar, Lightbox, etc.)
│   ├── content/
│   │   ├── projects/              # Markdown files for each portfolio project
│   │   └── site/                  # Profile & bio configuration (profile.json)
│   ├── layouts/                   # Global HTML & typography layout
│   └── pages/                     # Site routes (index.astro)
└── astro.config.mjs               # Astro & Tailwind configuration
```

---

## 📦 Legacy Version
The previous static HTML5 UP version of the portfolio has been safely backed up and preserved on the `legacy-archive` branch of this repository.
