// @ts-check
import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import sitemap from '@astrojs/sitemap'

/*
 * The public marketing and documentation site for Streamarr and the Playarr
 * clients. Static output only: every page is prerendered, so the build drops a
 * plain asset tree that any static host (or the local local-deploy container) can
 * serve without a runtime.
 *
 * The production hostname is not settled yet, so SITE_URL is the single knob
 * that feeds canonical URLs, Open Graph tags and the sitemap. Until it is set,
 * the site builds against the local-deploy public alias.
 */
const SITE_URL = process.env.SITE_URL ?? 'http://streamarr-marketing.example.com'

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [mdx(), sitemap()],
  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      wrap: false,
    },
  },
  vite: {
    server: {
      // The dev server runs inside the local Kubernetes cluster behind ingress, so
      // requests arrive with the local-deploy hostnames rather than localhost.
      allowedHosts: [
        'streamarr-marketing.localhost',
        'streamarr-marketing.dev.home.arpa',
        'streamarr-marketing.example.com',
      ],
    },
  },
})
