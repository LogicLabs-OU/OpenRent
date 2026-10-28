import type { LocalizedText } from '@openrent/plugin-sdk';

/**
 * The plugin's texts. Staff texts follow the admin (German Sie, Spanish usted, Dutch u); what customers
 * read follows the storefront (German Sie, Spanish tú, Dutch je, French vous).
 */
const LANGS = ['en', 'de', 'fr', 'es', 'et', 'ja', 'nl'] as const;
type Row = readonly [string, string, string, string, string, string, string];

const ROWS = {
  // Admin: plans
  plans_title: ['Membership plans', 'Mitgliedschaften', 'Formules d’adhésion', 'Planes de socio', 'Liikmepaketid', '会員プラン', 'Lidmaatschappen'],
  plans_description: [
    'Plans customers can join: a fee each month or year, a member price, and how many items members may have at once.',
    'Mitgliedschaften für Kunden: ein Beitrag pro Monat oder Jahr, ein Mitgliederpreis und wie viele Artikel Mitglieder gleichzeitig ausleihen dürfen.',
    'Les formules que les clients peuvent choisir : une cotisation par mois ou par an, un prix membre et le nombre d’articles empruntés en même temps.',
    'Los planes a los que pueden unirse los clientes: una cuota mensual o anual, un precio para socios y cuántos artículos pueden tener a la vez.',
    'Paketid, millega kliendid saavad liituda: tasu kuus või aastas, liikmehind ja mitu eset liikmel korraga olla võib.',
    'お客様が加入できるプランです。月額または年額の会費、会員価格、同時に借りられる点数を設定します。',
    'Lidmaatschappen waar klanten lid van kunnen worden: contributie per maand of jaar, een ledenprijs en hoeveel artikelen leden tegelijk mogen hebben.',
  ],
  plans_empty: ['No plans yet.', 'Noch keine Mitgliedschaften.', 'Aucune formule pour l’instant.', 'Aún no hay planes.', 'Pakette pole veel.', 'プランはまだありません。', 'Nog geen lidmaatschappen.'],
  col_plan: ['Plan', 'Mitgliedschaft', 'Formule', 'Plan', 'Pakett', 'プラン', 'Lidmaatschap'],
  col_fee: ['Fee', 'Beitrag', 'Cotisation', 'Cuota', 'Tasu', '会費', 'Contributie'],
  col_interval: ['Every', 'Alle', 'Tous les', 'Cada', 'Iga', '期間', 'Elke'],
  col_discount: ['Member price', 'Mitgliederpreis', 'Prix membre', 'Precio de socio', 'Liikmehind', '会員価格', 'Ledenprijs'],
  col_max: ['Items at once', 'Artikel gleichzeitig', 'Articles à la fois', 'Artículos a la vez', 'Esemeid korraga', '同時に借りられる点数', 'Artikelen tegelijk'],
  col_public: ['In the shop', 'Im Shop', 'En boutique', 'En la tienda', 'Poes', 'ショップに表示', 'In de winkel'],
  field_name: ['Name', 'Name', 'Nom', 'Nombre', 'Nimi', '名前', 'Naam'],
  field_fee: ['Fee before tax', 'Beitrag vor Steuern', 'Cotisation hors taxes', 'Cuota antes de impuestos', 'Tasu maksudeta', '税抜の会費', 'Contributie exclusief belasting'],
  field_interval: ['Charged every', 'Berechnet alle', 'Facturée tous les', 'Se cobra cada', 'Arveldatakse iga', '請求の間隔', 'In rekening gebracht elke'],
  interval_month: ['Month', 'Monat', 'Mois', 'Mes', 'Kuu', '月', 'Maand'],
  interval_year: ['Year', 'Jahr', 'An', 'Año', 'Aasta', '年', 'Jaar'],
  field_discount: ['Member discount (%)', 'Rabatt für Mitglieder (%)', 'Remise membre (%)', 'Descuento para socios (%)', 'Liikmesoodustus (%)', '会員割引（%）', 'Ledenkorting (%)'],
  field_discount_help: ['100 means members borrow for free.', '100 bedeutet, dass Mitglieder kostenlos ausleihen.', '100 signifie que les membres empruntent gratuitement.', '100 significa que los socios alquilan gratis.', '100 tähendab, et liikmed laenutavad tasuta.', '100 にすると会員は無料で借りられます。', '100 betekent dat leden gratis lenen.'],
  field_max: ['Items a member may have at once', 'Artikel, die ein Mitglied gleichzeitig haben darf', 'Articles qu’un membre peut avoir à la fois', 'Artículos que un socio puede tener a la vez', 'Esemeid, mis liikmel korraga olla võivad', '会員が同時に借りられる点数', 'Artikelen die een lid tegelijk mag hebben'],
  field_max_help: ['Leave empty for no limit.', 'Leer lassen für keine Grenze.', 'Laisser vide pour aucune limite.', 'Déjelo vacío para no poner límite.', 'Jätke tühjaks, kui piirangut pole.', '制限しない場合は空欄にしてください。', 'Leeg laten voor geen limiet.'],
  field_public: ['Show in the shop’s plan list', 'In der Liste des Shops zeigen', 'Afficher dans la liste de la boutique', 'Mostrar en la lista de la tienda', 'Näita poe pakettide loendis', 'ショップのプラン一覧に表示する', 'Tonen in de lijst van de winkel'],
  // Admin: a customer's membership
  members_title: ['Membership', 'Mitgliedschaft', 'Adhésion', 'Membresía', 'Liikmesus', '会員', 'Lidmaatschap'],
  members_description: [
    'Adding a plan sends the customer its first invoice; the membership starts when it is paid.',
    'Beim Hinzufügen erhält der Kunde die erste Rechnung; die Mitgliedschaft beginnt, sobald sie bezahlt ist.',
    'L’ajout d’une formule envoie la première facture au client ; l’adhésion commence quand elle est payée.',
    'Al añadir un plan, el cliente recibe la primera factura; la membresía empieza cuando se paga.',
    'Paketi lisamisel saadetakse kliendile esimene arve; liikmesus algab, kui see on tasutud.',
    'プランを追加するとお客様に最初の請求書が送られ、支払い後に会員が始まります。',
    'Bij het toevoegen krijgt de klant de eerste factuur; het lidmaatschap begint zodra die betaald is.',
  ],
  members_empty: ['Not a member.', 'Kein Mitglied.', 'Pas membre.', 'No es socio.', 'Ei ole liige.', '会員ではありません。', 'Geen lid.'],
  col_status: ['Status', 'Status', 'Statut', 'Estado', 'Olek', '状態', 'Status'],
  col_until: ['Paid until', 'Bezahlt bis', 'Payée jusqu’au', 'Pagada hasta', 'Tasutud kuni', '支払済みの期限', 'Betaald tot'],
  action_cancel: ['Cancel', 'Kündigen', 'Résilier', 'Cancelar', 'Lõpeta', '解約', 'Opzeggen'],
  action_cancel_confirm: [
    'The membership ends when the paid period ends; an unpaid one ends now and its invoice is voided.',
    'Die Mitgliedschaft endet mit dem bezahlten Zeitraum; eine unbezahlte endet sofort und ihre Rechnung wird storniert.',
    'L’adhésion se termine à la fin de la période payée ; une adhésion impayée se termine tout de suite et sa facture est annulée.',
    'La membresía termina al acabar el periodo pagado; una sin pagar termina ahora y su factura se anula.',
    'Liikmesus lõpeb tasutud perioodi lõpus; tasumata liikmesus lõpeb kohe ja selle arve tühistatakse.',
    '支払済みの期間が終わると会員は終了します。未払いの場合はすぐに終了し、請求書は取り消されます。',
    'Het lidmaatschap eindigt aan het eind van de betaalde periode; een onbetaald lidmaatschap eindigt nu en de factuur wordt geannuleerd.',
  ],
  action_resend: ['Send the payment link again', 'Zahlungslink erneut senden', 'Renvoyer le lien de paiement', 'Volver a enviar el enlace de pago', 'Saada makselink uuesti', '支払いリンクを再送', 'Betaallink opnieuw versturen'],
  status_pending: ['Waiting for payment', 'Wartet auf Zahlung', 'En attente de paiement', 'Pendiente de pago', 'Ootab makset', '支払い待ち', 'Wacht op betaling'],
  status_active: ['Active', 'Aktiv', 'Active', 'Activa', 'Aktiivne', '有効', 'Actief'],
  status_ending: ['Ends at period end', 'Endet mit dem Zeitraum', 'Se termine en fin de période', 'Termina al acabar el periodo', 'Lõpeb perioodi lõpus', '期間終了で終了', 'Eindigt aan het eind van de periode'],
  status_lapsed: ['Unpaid', 'Unbezahlt', 'Impayée', 'Sin pagar', 'Tasumata', '未払い', 'Onbetaald'],
  status_cancelled: ['Cancelled', 'Gekündigt', 'Résiliée', 'Cancelada', 'Lõpetatud', '解約済み', 'Opgezegd'],
  error_plan: ['Choose a plan', 'Wählen Sie eine Mitgliedschaft', 'Choisissez une formule', 'Elija un plan', 'Valige pakett', 'プランを選んでください', 'Kies een lidmaatschap'],
  error_name: ['Enter a name', 'Geben Sie einen Namen ein', 'Saisissez un nom', 'Introduzca un nombre', 'Sisestage nimi', '名前を入力してください', 'Voer een naam in'],
  error_fee: ['Enter a fee of 0 or more', 'Geben Sie einen Beitrag von 0 oder mehr ein', 'Saisissez une cotisation de 0 ou plus', 'Introduzca una cuota de 0 o más', 'Sisestage tasu 0 või rohkem', '0 以上の会費を入力してください', 'Voer een contributie van 0 of meer in'],
  error_discount: ['Enter a discount between 0 and 100 %', 'Geben Sie einen Rabatt zwischen 0 und 100 % ein', 'Saisissez une remise entre 0 et 100 %', 'Introduzca un descuento entre 0 y 100 %', 'Sisestage soodustus vahemikus 0 kuni 100 %', '0〜100 % の割引を入力してください', 'Voer een korting tussen 0 en 100 % in'],
  error_max: ['Enter at least 1 item, or leave it empty', 'Geben Sie mindestens 1 Artikel ein oder lassen Sie das Feld leer', 'Saisissez au moins 1 article ou laissez vide', 'Introduzca al menos 1 artículo o déjelo vacío', 'Sisestage vähemalt 1 ese või jätke tühjaks', '1 点以上を入力するか、空欄にしてください', 'Voer ten minste 1 artikel in of laat het leeg'],
  error_member: ['This customer has a membership already', 'Dieser Kunde hat bereits eine Mitgliedschaft', 'Ce client a déjà une adhésion', 'Este cliente ya tiene una membresía', 'Sellel kliendil on juba liikmesus', 'このお客様はすでに会員です', 'Deze klant heeft al een lidmaatschap'],
  error_plan_used: ['Members still have this plan; end their memberships first', 'Mitglieder haben diese Mitgliedschaft noch; beenden Sie zuerst deren Mitgliedschaften', 'Des membres ont encore cette formule ; mettez d’abord fin à leurs adhésions', 'Hay socios con este plan; termine primero sus membresías', 'Liikmetel on see pakett veel; lõpetage kõigepealt nende liikmesus', 'このプランの会員がまだいます。先に会員を終了してください', 'Leden hebben dit lidmaatschap nog; beëindig eerst hun lidmaatschappen'],
  // Settings
  setting_grace: ['Days a fee may stay unpaid before member prices pause', 'Tage, die ein Beitrag offen bleiben darf, bevor Mitgliederpreise pausieren', 'Jours pendant lesquels une cotisation peut rester impayée avant la suspension des prix membres', 'Días que una cuota puede quedar sin pagar antes de pausar los precios de socio', 'Päevad, mil tasu võib olla tasumata, enne kui liikmehinnad peatatakse', '会員価格を停止するまでの会費の未払い猶予日数', 'Dagen dat contributie onbetaald mag blijven voordat ledenprijzen stoppen'],
  // Customers
  panel_title: ['Membership', 'Mitgliedschaft', 'Adhésion', 'Membresía', 'Liikmesus', '会員', 'Lidmaatschap'],
  panel_active: ['{plan}: active until {date}.', '{plan}: aktiv bis {date}.', '{plan} : active jusqu’au {date}.', '{plan}: activa hasta el {date}.', '{plan}: aktiivne kuni {date}.', '{plan}: {date} まで有効です。', '{plan}: actief tot {date}.'],
  panel_ending: ['{plan}: ends on {date}.', '{plan}: endet am {date}.', '{plan} : se termine le {date}.', '{plan}: termina el {date}.', '{plan}: lõpeb {date}.', '{plan}: {date} に終了します。', '{plan}: eindigt op {date}.'],
  panel_pending: [
    '{plan}: your membership starts when its fee is paid. You find the invoice with your invoices above.',
    '{plan}: Ihre Mitgliedschaft beginnt, sobald der Beitrag bezahlt ist. Die Rechnung finden Sie oben bei Ihren Rechnungen.',
    '{plan} : votre adhésion commence dès que la cotisation est payée. La facture se trouve plus haut avec vos factures.',
    '{plan}: tu membresía empieza cuando pagues la cuota. Encontrarás la factura arriba, con tus facturas.',
    '{plan}: teie liikmesus algab, kui tasu on makstud. Arve leiate ülalt oma arvete juurest.',
    '{plan}: 会費のお支払い後に会員が始まります。請求書は上の請求書一覧にあります。',
    '{plan}: je lidmaatschap begint zodra de contributie betaald is. De factuur vind je hierboven bij je facturen.',
  ],
  panel_lapsed: [
    '{plan}: the fee is unpaid, so member prices are paused until it is paid.',
    '{plan}: Der Beitrag ist offen; Mitgliederpreise gelten erst wieder nach der Zahlung.',
    '{plan} : la cotisation est impayée ; les prix membres sont suspendus jusqu’au paiement.',
    '{plan}: la cuota está sin pagar, así que los precios de socio están en pausa hasta que la pagues.',
    '{plan}: tasu on maksmata, seega on liikmehinnad peatatud, kuni see on makstud.',
    '{plan}: 会費が未払いのため、お支払いまで会員価格は停止しています。',
    '{plan}: de contributie is onbetaald, dus ledenprijzen zijn gepauzeerd tot die betaald is.',
  ],
  benefit_free: ['You borrow for free.', 'Sie leihen kostenlos aus.', 'Vous empruntez gratuitement.', 'Alquilas gratis.', 'Laenutate tasuta.', '無料で借りられます。', 'Je leent gratis.'],
  benefit_discount: ['{pct} % off every rental.', '{pct} % Rabatt auf jede Miete.', '{pct} % de remise sur chaque location.', '{pct} % de descuento en cada alquiler.', '{pct} % soodustust igalt rendilt.', 'すべてのレンタルが {pct} % 引きです。', '{pct} % korting op elke huur.'],
  benefit_max: ['Up to {count} items at a time.', 'Bis zu {count} Artikel gleichzeitig.', 'Jusqu’à {count} articles à la fois.', 'Hasta {count} artículos a la vez.', 'Kuni {count} eset korraga.', '同時に {count} 点まで借りられます。', 'Tot {count} artikelen tegelijk.'],
  plan_line: ['{plan}: {fee} a {interval}', '{plan}: {fee} pro {interval}', '{plan} : {fee} par {interval}', '{plan}: {fee} al {interval}', '{plan}: {fee} {interval} kohta', '{plan}: {interval}あたり {fee}', '{plan}: {fee} per {interval}'],
  per_month: ['month', 'Monat', 'mois', 'mes', 'kuu', '月', 'maand'],
  per_year: ['year', 'Jahr', 'an', 'año', 'aasta', '年', 'jaar'],
  section_name: ['Membership plans', 'Mitgliedschaften', 'Formules d’adhésion', 'Planes de socio', 'Liikmepaketid', '会員プラン', 'Lidmaatschappen'],
  section_heading: ['Heading', 'Überschrift', 'Titre', 'Título', 'Pealkiri', '見出し', 'Kop'],
  section_heading_default: ['Become a member', 'Mitglied werden', 'Devenez membre', 'Hazte socio', 'Hakka liikmeks', '会員になる', 'Word lid'],
  section_text: ['Text', 'Text', 'Texte', 'Texto', 'Tekst', '本文', 'Tekst'],
  section_text_default: ['Ask us at the counter to join.', 'Fragen Sie uns am Schalter, um Mitglied zu werden.', 'Demandez-nous au comptoir pour adhérer.', 'Pregúntanos en el mostrador para hacerte socio.', 'Liitumiseks küsige meilt letis.', '加入はカウンターでお尋ねください。', 'Vraag ons aan de balie om lid te worden.'],
  limit: [
    '{plan} members can have {max} items at a time; this booking would make {count}.',
    'Mitglieder mit {plan} können {max} Artikel gleichzeitig haben; mit dieser Buchung wären es {count}.',
    'Les membres {plan} peuvent avoir {max} articles à la fois ; cette réservation en ferait {count}.',
    'Los socios de {plan} pueden tener {max} artículos a la vez; con esta reserva serían {count}.',
    'Paketi {plan} liikmetel võib korraga olla {max} eset; selle broneeringuga oleks neid {count}.',
    '{plan} の会員が同時に借りられるのは {max} 点までです。この予約で {count} 点になります。',
    'Leden met {plan} mogen {max} artikelen tegelijk hebben; met deze boeking worden het er {count}.',
  ],
  invoice_line: ['Membership {plan}, {from} to {to}', 'Mitgliedschaft {plan}, {from} bis {to}', 'Adhésion {plan}, du {from} au {to}', 'Membresía {plan}, del {from} al {to}', 'Liikmesus {plan}, {from} kuni {to}', '会員 {plan}（{from}〜{to}）', 'Lidmaatschap {plan}, {from} tot {to}'],
  rule_name: ['Member price ({plan})', 'Mitgliederpreis ({plan})', 'Prix membre ({plan})', 'Precio de socio ({plan})', 'Liikmehind ({plan})', '会員価格（{plan}）', 'Ledenprijs ({plan})'],
} satisfies Record<string, Row>;

export type TextKey = keyof typeof ROWS;

/** All languages of a text, for labels the admin and storefront pick from. */
export function all(key: TextKey): LocalizedText {
  return Object.fromEntries(LANGS.map((l, i) => [l, ROWS[key][i]!]));
}

/** One text in `locale` (English when the language is missing), with `{name}` filled in. */
export function text(key: TextKey, locale: string | null | undefined, params: Record<string, string | number> = {}): string {
  const i = Math.max(0, LANGS.indexOf((locale ?? 'en').slice(0, 2) as (typeof LANGS)[number]));
  return ROWS[key][i]!.replace(/\{(\w+)\}/g, (_m, k: string) => String(params[k] ?? ''));
}
