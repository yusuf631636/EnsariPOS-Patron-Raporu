/* Oturum suresi dolarsa (401) kullaniciyi otomatik giris sayfasina yollar.
   patron.html ve index.html tarafindan diger scriptlerden once yuklenir. */
(function () {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => realFetch(input, init).then(response => {
    if (response.status === 401) location.href = '/login?next=' + encodeURIComponent(location.pathname + location.search);
    return response;
  });
})();
