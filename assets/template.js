$(document).ready(function() {
    parseData();
    registerAccordionCallbacks();

    $('#export').on('click', function () {
        $('body').scrollTop(0);
        $('#export').hide();
        createPDF();
        $('#export').show();
    });
});

$(window).load(function() {
    $('.contOut').animate({'opacity':'1'}, 1200);
});

function registerAccordionCallbacks() {
  $(document).on("click", ".job", function(){
       console.log('clicked job');

       if ($(this).hasClass('open')) {

          $(this).removeClass('open')
                 .removeClass('fa-minus')
                 .addClass('fa-plus');

          $(this).closest('.job')
                 .find('p')
                 .animate({'opacity':'0'},200)
                 .slideUp();

        } else {
          $(this).addClass('open')
                 .removeClass('fa-plus')
                 .addClass('fa-minus');

          $(this).closest('.job')
                 .find('p')
                 .slideDown()
                 .animate({'opacity':'1'},400);
        }
  });
}

function parseData() {
      fetch('./data.json')
          .then((response) => response.json())
          .then((data) => {
                document.getElementById("imageURL").src = data.imageURL;
                document.getElementById("name").innerHTML = data.name;

                document.getElementById("email").innerHTML = data.email;
                document.getElementById("email").href = 'mailto:' + data.email;

                document.getElementById("addressStreet").innerHTML = data.addressStreet;
                document.getElementById("addressLocation").innerHTML = data.addressLocation;
                document.getElementById("phone").innerHTML = data.phone;

                document.getElementById("currentTitle").innerHTML = data.workExperience[0].title;
                document.getElementById("languages").innerHTML = data.languages;

                let rootElement = document.getElementById("workExperience");
                fetch('job_element_template.html').then(response => response.text()).then(template => {
                    let workExperience = data.workExperience;

                    for (let i = 0; i < workExperience.length; i++) {
                        let entry = workExperience[i];
                        let isFirst = (i == 0);
                        let style = isFirst ? "opacity: 1; display: block;" : "opacity: 0; display: none;";
                        let status = isFirst ? "open fa-minus" : "fa-plus";


                        let workEntry = template
                            .replaceAll("{company}", entry.company)
                            .replaceAll("{startDate}", entry.startDate)
                            .replaceAll("{endDate}", entry.endDate)
                            .replaceAll("{title}", entry.title)
                            .replaceAll("{style}", style)
                            .replaceAll("{status}", status);

                        var element = document.createElement('div');
                        element.innerHTML = workEntry;

                        rootElement.appendChild(element);
                    }
                })

          });
}

function createPDF() {
    var element = document.body;

    var opt = {
      margin:       1,
      filename:     'Resume_Peter_Savidis.pdf',
      image:        { type: 'jpeg', quality: 0.98 },
      html2canvas:  { scale: 2,useCORS: true },
      jsPDF:        { unit: 'mm', format: 'a4', orientation: 'p' }
    };

    html2pdf(element, opt);
}