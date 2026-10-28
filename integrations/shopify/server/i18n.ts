/** The settings page's texts, in the merchant's admin language (Shopify passes `locale`). */
const L = ['en', 'de', 'fr', 'es', 'et', 'ja', 'nl'] as const;
type Lang = (typeof L)[number];
const r = (...v: string[]) => Object.fromEntries(L.map((l, i) => [l, v[i]!])) as Record<Lang, string>;

const T = {
  title: r('OpenRent', 'OpenRent', 'OpenRent', 'OpenRent', 'OpenRent', 'OpenRent', 'OpenRent'),
  connected: r('Connected to {shop} at {url}.', 'Verbunden mit {shop} unter {url}.', 'Connecté à {shop} sur {url}.', 'Conectado a {shop} en {url}.', 'Ühendatud poega {shop} aadressil {url}.', '{url} の {shop} に接続しています。', 'Gekoppeld aan {shop} op {url}.'),
  blocks: r(
    'In the theme editor, add the OpenRent blocks under Apps: a product, a category or a book button.',
    'Fügen Sie im Theme-Editor unter Apps die OpenRent-Blöcke hinzu: ein Produkt, eine Kategorie oder einen Buchungsbutton.',
    'Dans l’éditeur de thème, ajoutez les blocs OpenRent sous Applications : un produit, une catégorie ou un bouton de réservation.',
    'En el editor de temas, añada los bloques de OpenRent en Aplicaciones: un producto, una categoría o un botón de reserva.',
    'Teemaredaktoris lisage jaotises Rakendused OpenRenti plokid: toode, kategooria või broneerimisnupp.',
    'テーマエディターの「アプリ」から OpenRent ブロック（商品、カテゴリー、予約ボタン）を追加してください。',
    'Voeg in de thema-editor onder Apps de OpenRent-blokken toe: een product, een categorie of een boekknop.',
  ),
  intro: r(
    'Show your OpenRent rentals in this shop: connect it to your OpenRent, then add the blocks in the theme editor.',
    'Zeigen Sie Ihre OpenRent-Mietartikel in diesem Shop: Verbinden Sie ihn mit Ihrem OpenRent und fügen Sie dann die Blöcke im Theme-Editor hinzu.',
    'Affichez vos locations OpenRent dans cette boutique : connectez-la à votre OpenRent, puis ajoutez les blocs dans l’éditeur de thème.',
    'Muestre sus alquileres de OpenRent en esta tienda: conéctela a su OpenRent y añada después los bloques en el editor de temas.',
    'Näidake oma OpenRenti renditooteid selles poes: ühendage see oma OpenRentiga ja lisage siis teemaredaktoris plokid.',
    'このストアに OpenRent のレンタル商品を表示します。OpenRent に接続してから、テーマエディターでブロックを追加してください。',
    'Toon uw OpenRent-verhuur in deze winkel: koppel hem aan uw OpenRent en voeg daarna de blokken toe in de thema-editor.',
  ),
  address: r('OpenRent address', 'OpenRent-Adresse', 'Adresse d’OpenRent', 'Dirección de OpenRent', 'OpenRenti aadress', 'OpenRent のアドレス', 'OpenRent-adres'),
  address_hint: r('Where your OpenRent runs, such as https://rent.example.com. You sign in there and approve this shop.', 'Wo Ihr OpenRent läuft, z. B. https://rent.example.com. Dort melden Sie sich an und genehmigen diesen Shop.', 'L’adresse de votre OpenRent, p. ex. https://rent.example.com. Vous vous y connectez et approuvez cette boutique.', 'Donde funciona su OpenRent, p. ej., https://rent.example.com. Allí inicia sesión y aprueba esta tienda.', 'Kus teie OpenRent töötab, nt https://rent.example.com. Seal logite sisse ja kinnitate selle poe.', 'OpenRent が動いているアドレス（例：https://rent.example.com）です。そこでサインインし、このストアを承認します。', 'Waar uw OpenRent draait, bijv. https://rent.example.com. Daar meldt u zich aan en keurt u deze winkel goed.'),
  connect: r('Connect to OpenRent', 'Mit OpenRent verbinden', 'Connecter à OpenRent', 'Conectar con OpenRent', 'Ühenda OpenRentiga', 'OpenRent に接続', 'Koppelen aan OpenRent'),
  disconnect: r('Disconnect', 'Trennen', 'Déconnecter', 'Desconectar', 'Ühenda lahti', '接続解除', 'Ontkoppelen'),
  bad_address: r('Enter the OpenRent address, starting with https://.', 'Geben Sie die OpenRent-Adresse ein, beginnend mit https://.', 'Saisissez l’adresse d’OpenRent, commençant par https://.', 'Introduzca la dirección de OpenRent, empezando por https://.', 'Sisestage OpenRenti aadress, mis algab https://-ga.', 'https:// で始まる OpenRent のアドレスを入力してください。', 'Vul het OpenRent-adres in, beginnend met https://.'),
  failed: r('OpenRent could not be connected: {message}', 'OpenRent konnte nicht verbunden werden: {message}', 'Impossible de connecter OpenRent : {message}', 'No se pudo conectar OpenRent: {message}', 'OpenRenti ei õnnestunud ühendada: {message}', 'OpenRent に接続できませんでした：{message}', 'OpenRent kon niet worden gekoppeld: {message}'),
  declined: r('The connection was declined in OpenRent.', 'Die Verbindung wurde in OpenRent abgelehnt.', 'La connexion a été refusée dans OpenRent.', 'La conexión se rechazó en OpenRent.', 'Ühendamisest keelduti OpenRentis.', 'OpenRent で接続が拒否されました。', 'De koppeling is in OpenRent geweigerd.'),
  done: r('Connected to OpenRent.', 'Mit OpenRent verbunden.', 'Connecté à OpenRent.', 'Conectado a OpenRent.', 'OpenRentiga ühendatud.', 'OpenRent に接続しました。', 'Gekoppeld aan OpenRent.'),
  gone: r('Disconnected from OpenRent.', 'Von OpenRent getrennt.', 'Déconnecté d’OpenRent.', 'Desconectado de OpenRent.', 'OpenRentist lahti ühendatud.', 'OpenRent との接続を解除しました。', 'Ontkoppeld van OpenRent.'),
  expired: r('This page is out of date. Open the app again from the Shopify admin.', 'Diese Seite ist veraltet. Öffnen Sie die App erneut über den Shopify-Admin.', 'Cette page n’est plus à jour. Rouvrez l’application depuis l’administration Shopify.', 'Esta página está desactualizada. Vuelva a abrir la aplicación desde el administrador de Shopify.', 'See leht on aegunud. Avage rakendus uuesti Shopify halduses.', 'このページは古くなっています。Shopify 管理画面からアプリを開き直してください。', 'Deze pagina is verouderd. Open de app opnieuw vanuit de Shopify-beheeromgeving.'),
};

export type Key = keyof typeof T;

export function lang(raw: string | null | undefined): Lang {
  const l = String(raw ?? 'en').slice(0, 2).toLowerCase();
  return (L as readonly string[]).includes(l) ? (l as Lang) : 'en';
}

export function t(l: Lang, key: Key, params: Record<string, string> = {}) {
  return T[key][l].replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');
}
