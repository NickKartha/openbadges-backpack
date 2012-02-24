_.templateSettings = {
  escape : /\[\[(.+?)\]\]/g
};

jQuery.extend({
  meta: function(name, value) {
    return $("meta[http-equiv='" + name + "']").attr("content", value);
  }
});

var Testing = (function setupTestingEnvironment() {
  if (window.parent !== window)
    return;

  var FAKE_XHR_DELAY = 10;
  var ASSERTIONS = [
    "http://foo.org/badge.json",
    "http://foo.org/nonexistent.json",
    "http://bar.org/badge.json"
  ];
  var RESPONSES = {
    "http://foo.org/badge.json": {
      exists: false,
      badge: {
        "recipient": "example@example.com",
        "evidence": "/badges/html5-basic/example",
        "badge": {
          "version": "0.5.0",
          "name": "HTML5 Fundamental",
          "image": "/_demo/cc.large.png",
          "description": "Knows the difference between a <section> and an <article>",
          "criteria": "/badges/html5-basic",
          "issuer": {
            "origin": "http://p2pu.org",
            "name": "P2PU",
            "org": "School of Webcraft",
            "contact": "admin@p2pu.org"
          }
        }
      }
    },
    "http://bar.org/badge.json": {
      exists: true,
      badge: {
        "recipient": "example@example.com",
        "evidence": "/badges/html4-basic/example",
        "badge": {
          "version": "0.5.0",
          "name": "HTML4 Fundamental",
          "image": "/_demo/cc.large.png",
          "description": "Knows the difference between a <p> and an <b>",
          "criteria": "/badges/html4-basic",
          "issuer": {
            "origin": "http://p2pu.org",
            "name": "P2PU",
            "org": "School of Webcraft",
            "contact": "admin@p2pu.org"
          }
        }
      }
    }
  };

  function show(text) {
    var div = $('<pre style="whitespace: pre-wrap"></pre>');
    div.text(text);
    $("#body").append(div);
    div.hide().slideDown();
  }
  
  var fakeResponseHandlers = {
    "POST /backpack/authenticate": function(options, cb) {
      cb(200, 'OK', {
        json: {
          email: options.data.assertion
        }
      });
    },
    "POST /issuer/assertion": function(options, cb) {
      cb(200, 'OK');
    },
    "GET /issuer/assertion": function(options, cb) {
      if (options.data.url in RESPONSES) {
        cb(200, 'OK', {json: RESPONSES[options.data.url]});
      } else
        cb(404, 'Not Found');
    }
  };
  
  jQuery.meta("X-Current-User", "example@example.com");
  jQuery.ajaxTransport("+*", function(options, originalOptions, jqXHR) {
    return {
      send: function(headers, completeCallback) {
        setTimeout(function() {
          var string = options.type + " " + originalOptions.url;
          if (string in fakeResponseHandlers) {
            fakeResponseHandlers[string]({
              data: originalOptions.data
            }, completeCallback);
          } else {
            completeCallback(404, 'Not Found');
          }
          //console.log("ajax", options.type, originalOptions.url, options, originalOptions, headers);
        }, FAKE_XHR_DELAY);
      },
      abort: function() {
        throw new Error("abort() is not implemented!");
      }
    };
  });
  
  $(window).ready(function() {
    window.issue(ASSERTIONS, function(errors, successes) {
      show("If this page were not in test mode, it would close now, " +
           "and the following information would be passed back " +
           "to the parent frame.\n\n" + 
           "errors:\n\n" + JSON.stringify(errors, null, " ") +
           "\n\nsuccesses:\n\n" + JSON.stringify(successes, null, " "));
    });
    $('<hr>').appendTo("#body");
    show("This page is operating in test mode. All data and " +
         "network operations are simulated.");
  });
  navigator.id.getVerifiedEmail = function(cb) {
    var email = "someone_else@example.com";
    show("We just simulated a BrowserID login of " + email + ".");
    cb(email);
  };
  return null;
})();

var Session = (function() {
  var loginStarted = false;
  var Session = {
    CSRF: jQuery.meta("X-CSRF-Token"),
    currentUser: jQuery.meta("X-Current-User"),
    login: function() {
      if (!loginStarted) {
        navigator.id.getVerifiedEmail(function(assertion) {
          jQuery.ajax({
            url: '/backpack/authenticate',
            type: 'POST',
            dataType: 'json',
            data: {assertion: assertion},
            success: function(data) {
              Session.currentUser = data.email;
              Session.trigger("login-complete");
            },
            error: function() {
              Session.trigger("login-error");
            },
            complete: function() {
              loginStarted = false;
            }
          });
        });
        loginStarted = true;
        Session.trigger('login-started');
      }
    }
  };

  _.extend(Session, Backbone.Events);

  jQuery.ajaxSetup({
    beforeSend: function (xhr, settings) {
      if (!settings.crossDomain && settings.type != "GET")
        xhr.setRequestHeader('X-CSRF-Token', Session.CSRF)
    }
  });

  return Session;
})();

function showBadges() {
  $("#welcome").fadeOut(Assertions.processNext);
}

$(window).ready(function() {
  if (!Session.currentUser) {
    $(".logged-out").show();
    $(".logged-out .js-browserid-link").click(function() {
      Session.login();
      return false;
    });
  } else {
    $(".logged-in").show();
    $(".logged-in .next").click(showBadges);
    $(".logged-in .email").text(Session.currentUser);
    $(".logged-in .logout").click(function() {
      $(".logged-in .next").unbind("click");
      Session.login();
      return false;
    });
  }

  // TODO: Also need to bind to login-error event.
  Session.on("login-complete", showBadges);
  $(".host").text(window.location.host);
  
  var channel = buildChannel();
});

// This is the core issuing implementation; the response is proxied
// back to the parent window. The function is global so it can be
// overridden from testing suites.
function issue(assertions, cb) {
  $("#welcome").fadeIn();
  var errors = [];
  var successes = [];
  window.Assertions = {
    processNext: function() {
      if (assertions.length == 0) {
        // We're on our way out. Disable all event handlers on the page,
        // so the user can't do anything.
        $("button, a").unbind();
        cb(errors, successes);
        return;
      }
      var url = assertions.pop();
      // TODO: parse the URL to see if it's malformed.
      jQuery.ajax({
        url: '/issuer/assertion',
        data: {
          url: url
        },
        success: function(obj) {
          if (obj.exists) {
            errors.push({
              url: url,
              reason: 'EXISTS'
            });
            processNext();
          } else {
            // TODO: Check to see if it's issued to the current user?
            var template = _.template($("#badge-ask-template").html());
            var html = template({
              hostname: url,
              assertion: obj.badge
            });
            $("#badge-ask").html(html).fadeIn();
            $("#badge-ask .accept").click(function() {
              jQuery.ajax({
                type: 'POST',
                url: '/issuer/assertion',
                data: {
                  url: url
                },
                success: function() {
                  successes.push(url);
                },
                error: function() {
                  // TODO: Display an error to the user.
                  errors.push({
                    url: url,
                    // TODO: Is this really the best reason?
                    reason: 'INACCESSIBLE'
                  });
                },
                complete: function() {
                  $("#badge-ask").fadeOut(processNext);
                }
              });
            });
            $("#badge-ask .reject").click(function() {
              errors.push({
                url: url,
                reason: 'DENIED'
              });
              $("#badge-ask").fadeOut(processNext);
            });
          }
        },
        error: function() {
          errors.push({
            url: url,
            reason: 'INACCESSIBLE'
          });
          processNext();
        }
      });
    }
  };
  var processNext = window.Assertions.processNext;
  $(".topbar .close").click(function() {
    assertions.forEach(function(assertion) {
      errors.push({
        url: assertion,
        reason: 'DENIED'
      });
    });
    assertions = [];
    processNext();
    return false;
  });
}

function buildChannel() {
  if (window.parent === window)
    return null;
  
  var channel = Channel.build({
    window: window.parent,
    origin: "*",
    scope: "OpenBadges.issue"
  });

  channel.bind("issue", function(trans, s) {
    issue(s, function(errors, successes) {
      trans.complete([errors, successes]);
    });
    trans.delayReturn(true);
  });
  
  return channel;
}
