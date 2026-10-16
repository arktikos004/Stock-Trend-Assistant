// 不加 "use client"：root layout（Server Component）要讀到實際字串，而不是 client reference。

/** 首次繪製前套用主題與漲跌顏色（layout 內嵌），避免閃爍；沒選過就用深色、紅漲綠跌 */
export const THEME_BOOT_SCRIPT = `(function(){var m="dark",u="red-up";try{var v=localStorage.getItem("theme");if(v==="light"||v==="system")m=v;if(localStorage.getItem("updown")==="green-up")u="green-up"}catch(e){}var d=document.documentElement;d.setAttribute("data-theme",m);d.setAttribute("data-updown",u)})();`;
