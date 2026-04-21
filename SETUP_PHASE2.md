# Phase 2 — Week 1 Setup Notes

Two shipped additions:

1. **Outcomes / Case Studies strip** (`#outcomes` section, homepage)
2. **Scheduler slide-over** with qualifying form + embedded calendar

The case studies are ready to go. The scheduler needs two config values to reach full capability — until you wire them in, it **still works** with graceful fallbacks.

---

## 1. Wire up Microsoft Bookings

**Where:** top of the `<script>` block at the bottom of `index.html` (search for `BOOKINGS_URL`).

**Steps:**

1. Go to [https://outlook.office.com/bookings/](https://outlook.office.com/bookings/) and create a booking page for "PowerMates — Tenant Scan discovery call" (20 min).
2. Add yourself (and Alex) as staff, pick availability windows, keep it private if you don't want public listing.
3. From the Bookings page, click **Share → Embed** (or **Get link**).
4. Copy the URL that looks like:

   ```
   https://outlook.office365.com/owa/calendar/PowerMates@thepowermates.com/bookings/
   ```

5. Paste into `BOOKINGS_URL` in `index.html`:

   ```js
   const BOOKINGS_URL = 'https://outlook.office365.com/owa/calendar/PowerMates@thepowermates.com/bookings/';
   ```

Once set, the scheduler's Step 2 renders an inline iframe with the live calendar.

**If left blank:** the scheduler still submits the form and shows a "Drop us a line at gaston@thepowermates.com" fallback. Not as polished, but functional.

---

## 2. (Optional) Wire up Power Automate webhook

This gives you the qualifying answers **the moment someone submits the form** — before they pick a time. Useful for:
- Immediate Teams notification
- Auto-tagging in HubSpot / Dynamics
- Screening leads before the call confirms

**Steps:**

1. Open [make.powerautomate.com](https://make.powerautomate.com/).
2. New flow → **Instant cloud flow** → Trigger: **When a HTTP request is received**.
3. Paste this into the Request Body JSON Schema:

   ```json
   {
     "type": "object",
     "properties": {
       "tenantSize":  { "type": "string" },
       "biggestPain": { "type": "string" },
       "timeline":    { "type": "string" },
       "email":       { "type": "string" },
       "company":     { "type": "string" },
       "timestamp":   { "type": "string" },
       "source":      { "type": "string" }
     }
   }
   ```

4. Add action: **Send an email (V2)** → To yourself, Subject: `New Tenant Scan inquiry: @{triggerBody()?['company']}`, Body: include all fields.
5. Save the flow. Copy the **HTTP POST URL** that appears on the trigger.
6. Paste into `FORM_WEBHOOK` in `index.html`:

   ```js
   const FORM_WEBHOOK = 'https://prod-XX.westus.logic.azure.com:443/workflows/…';
   ```

**If left blank:** the form still submits and advances to the calendar step — you just won't get the lead email until they confirm a booking slot.

---

## What triggers the scheduler

Any element with `data-scheduler` attribute **or** any link with `href="#schedule"` / `href="#book"`. Currently wired:

- Nav bar "Book a call →" (was Tally form)
- Hero "Book a 20-min call" secondary CTA

To add more triggers later, just drop `data-scheduler` on any link:

```html
<a href="#schedule" data-scheduler class="btn-primary">Talk to us</a>
```

---

## Deploy checklist

- [ ] `BOOKINGS_URL` set (required for good UX)
- [ ] `FORM_WEBHOOK` set (optional, but recommended)
- [ ] Bookings page tested end-to-end in an incognito window
- [ ] Power Automate flow triggered at least once manually
- [ ] Calendar confirmation email received by the test booker
