# EU VAT numbers and Slack notices

## EU VAT numbers (VIES)

Turn on **EU VAT numbers (VIES)** in **Plugins**. Optionally enter **Your VAT number**: VIES then gives a consultation number with each check, which you can keep as proof that you checked.

- A customer's VAT number is checked when it is saved, in the admin or at checkout. The customer page shows the result, the name and address VIES has for the number, and the consultation number. **Check again** asks VIES again, for example after an outage.
- At checkout, a number VIES says is not valid is refused under the VAT field, so the customer can fix it or leave it empty.
- A business with a valid number in another EU country pays no VAT: the booking is priced at 0 % and quotes and invoices say **Reverse charge** (Article 196 of the VAT Directive). Customers in your own country, outside the EU or without a valid number pay VAT as usual.
- When VIES or a member state cannot answer, VAT is charged. An outage never removes tax.

The shop's country comes from the location's address, or from your own VAT number.

## Slack notices

Turn on **Slack notices** in **Plugins** and paste an incoming webhook URL from Slack (Apps → Incoming Webhooks → Add to a channel). The notices staff get in the admin then also go to that channel, with a link to the booking. Each kind (new bookings, failed payments, overdue returns and others) can be switched off.
