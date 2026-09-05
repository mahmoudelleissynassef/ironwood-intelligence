# Supabase auth email templates

Paste each file's contents into **Supabase → Authentication → Emails**, matching
the file to the template of the same name. They are versioned here so the
branding cannot drift from the product.

Design follows the same palette as the weekly recap in `scraper-factory/cron_run.py`
(ink #0d0d0d, gold #b8933f, warm neutrals) so every email Ironwood sends looks
like it came from the same company.

Email-safe by construction: tables not flexbox, inline styles only, no external
CSS or webfonts, Georgia/Arial/Courier fallbacks. The call to action is a
bulletproof table-based button so it survives Outlook, and every template repeats
the destination as plain text underneath for clients that strip buttons.

Supabase substitutes `{{ .ConfirmationURL }}` at send time — leave it exactly as
written, including the spaces inside the braces.
