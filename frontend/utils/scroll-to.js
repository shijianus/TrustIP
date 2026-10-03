// Smooth scroll to specified element (supports passing element or id string)
export function scrollToElement(el, offset = 0) {
    const element = typeof el === 'string' ? document.getElementById(el) : el;
    if (!element) return;
    const y = element.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: y, behavior: 'smooth' });
}

// How tall the page header is: the brand row (`h-14`, Nav.vue /
// StandalonePageHeader.vue) plus the route rail row (`h-10`, NavRail.vue).
// index.html reserves the same total as the body's top padding, and every
// scroll target on the page subtracts this — plus whatever breathing room its
// call site wants — or the heading it scrolled to lands hidden underneath.
export const HEADER_HEIGHT = 96;
