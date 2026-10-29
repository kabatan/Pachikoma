// scenes/_list.json に書かれたシーンのスクリプトを順に読み込む。LCD.loadScenes(rootUrl)
(function () {
  LCD.loadScenes = async function (rootUrl) {
    const list = await (await fetch(rootUrl + 'work/effects/lcd/scenes/_list.json')).json();
    for (const f of list) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = rootUrl + 'work/effects/lcd/scenes/' + f + '?v=' + Date.now(); s.onload = res; s.onerror = () => rej(new Error('scene ' + f)); document.head.append(s); });
    return list;
  };
})();
