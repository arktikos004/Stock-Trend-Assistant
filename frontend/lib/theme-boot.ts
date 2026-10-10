// 不加 "use client"：root layout（Server Component）要讀到實際字串，而不是 client reference。

/** 首次繪製前套用主題（layout 內嵌），避免深淺閃爍；沒選過就用深色 */
export const THEME_BOOT_SCRIPT = `(function(){var m="dark";try{var v=localStorage.getItem("theme");if(v==="light"||v==="system")m=v}catch(e){}document.documentElement.setAttribute("data-theme",m)})();`;
