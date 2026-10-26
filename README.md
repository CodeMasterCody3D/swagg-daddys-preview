# Swagg Daddys Mobile Mechanics

A temporary website design preview, using the supplied Swagg Daddys logo and a responsive black-and-mint layout.

## Preview status

Phone number, service area, hours, and the final list of offered services need the business owner's confirmation. On the GitHub preview, the request form only prepares a message for copying; it does not send requests, store files, or book appointments.

The intake flow now includes an urgency choice, explicit GPS/location permission, precise coordinates, a location-use disclosure, and optional photo/video evidence for flexible requests. Location access is requested only when the visitor presses the location button.

## GitHub Pages

Publish the main branch from the repository root. To stop temporary hosting later, open Settings → Pages and unpublish the site (or set the publishing branch to None). Keep the repository and files.

## Netlify

Import this repository. No build command is needed. Publish directory: `.`. The included netlify.toml supplies this configuration. Netlify form handling will receive the approved form, coordinates, and media upload after deployment. Connect the purchased domain after the owner approves the website.

## Editing

`index.html` contains the page, responsive styles, and request-message behavior. The logo is `assets/swagg-daddys-logo.webp`. There are no required packages, external fonts, or third-party scripts.
