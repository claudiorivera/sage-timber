(($) => {
  // Site title
  wp.customize("blogname", (value) => {
    value.bind((to) => {
      $(".brand").text(to);
    });
  });
})(jQuery);
