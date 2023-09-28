const imageContainer = document.getElementById("image-container");
const image = document.getElementById("image");
const previousButton = document.getElementById("previous");
const nextButton = document.getElementById("next");

// Array of image file names
const images = ["0001.jpg", "0002.jpg", "0003.jpg", "0004.jpg"];
let currentPage = 0;

function showImage(page) {
    if (page >= 0 && page < images.length) {
        image.src = images[page];
        currentPage = page;
    }
}

// Initial display
showImage(currentPage);

previousButton.addEventListener("click", () => {
    showImage(currentPage - 1);
});

nextButton.addEventListener("click", () => {
    showImage(currentPage + 1);
});
