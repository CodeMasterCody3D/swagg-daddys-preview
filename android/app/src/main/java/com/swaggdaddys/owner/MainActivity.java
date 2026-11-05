package com.swaggdaddys.owner;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.text.InputType;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.SslErrorHandler;
import android.webkit.GeolocationPermissions;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;
import org.json.JSONTokener;

/** A small owner-only website wrapper. Passwords and customer records stay on the website. */
public final class MainActivity extends Activity {
    private static final int BACKGROUND = Color.rgb(8, 13, 12);
    private static final int MINT = Color.rgb(71, 237, 189);
    private static final int LOCATION_PERMISSION = 721;
    private static final int CAMERA_PERMISSION = 722;
    private static final int VIN_PHOTO = 723;
    private PermissionRequest pendingCamera;
    private ValueCallback<Uri[]> pendingPhoto;
    private GeolocationPermissions.Callback pendingLocation;
    private String pendingLocationOrigin;
    private WebView web;
    private ProgressBar progress;
    private LinearLayout errorPanel;
    private TextView errorMessage;
    private String retryUrl = NavigationPolicy.HOME;
    private boolean destroyed;
    private OwnerPushController push;
    private OwnerUpdateController updates;

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BACKGROUND);
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout());
                Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right,
                        Math.max(bars.bottom, keyboard.bottom));
                return WindowInsets.CONSUMED;
            });
        }

        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(14), 0, dp(4), 0);
        TextView title = new TextView(this);
        title.setText("Swagg Daddys · Owner");
        title.setTextColor(MINT);
        title.setTextSize(15);
        bar.addView(title, new LinearLayout.LayoutParams(0, dp(48), 1));
        title.setGravity(Gravity.CENTER_VERTICAL);
        Button menu = new Button(this);
        menu.setText("⋮");
        menu.setTextSize(25);
        menu.setTextColor(MINT);
        menu.setBackgroundColor(Color.TRANSPARENT);
        menu.setContentDescription("App menu");
        menu.setOnClickListener(v -> showMenu(menu));
        bar.addView(menu, new LinearLayout.LayoutParams(dp(48), dp(48)));
        root.addView(bar);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setProgressTintList(ColorStateList.valueOf(MINT));
        progress.setMax(100);
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(2)));

        FrameLayout content = new FrameLayout(this);
        web = new WebView(this);
        web.setId(View.generateViewId());
        web.setBackgroundColor(BACKGROUND);
        configureWebView();
        content.addView(web, new FrameLayout.LayoutParams(-1, -1));
        errorPanel = new LinearLayout(this);
        errorPanel.setOrientation(LinearLayout.VERTICAL);
        errorPanel.setGravity(Gravity.CENTER);
        errorPanel.setPadding(dp(28), dp(24), dp(28), dp(24));
        errorPanel.setBackgroundColor(BACKGROUND);
        errorMessage = new TextView(this);
        errorMessage.setTextColor(Color.WHITE);
        errorMessage.setTextSize(18);
        errorMessage.setGravity(Gravity.CENTER);
        errorPanel.addView(errorMessage);
        Button retry = new Button(this);
        retry.setText("Try again");
        retry.setOnClickListener(v -> loadOwner(retryUrl));
        errorPanel.addView(retry);
        errorPanel.setVisibility(View.GONE);
        content.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
        root.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        push = new OwnerPushController(this);
        updates = new OwnerUpdateController(this);

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
        // Do not serialize a WebView history/form snapshot containing customer information.
        loadOwner(NavigationPolicy.HOME);
    }

    @SuppressWarnings("deprecation")
    private void configureWebView() {
        WebSettings settings = web.getSettings();
        settings.setUserAgentString(settings.getUserAgentString() + " SwaggDaddysOwner/"
                + BuildConfig.VERSION_NAME + " (build:" + BuildConfig.VERSION_CODE + ")");
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        // The system image picker grants access only to user-selected content URIs.
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // Location is offered only to swaggdaddys.com, for the mileage estimate on a request.
        settings.setGeolocationEnabled(true);
        settings.setSaveFormData(false);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view,
                                                              WebResourceRequest request) {
                return route(request.getUrl().toString(), request.isForMainFrame(), request.hasGesture());
            }

            @Override public void onPageStarted(WebView view, String url,
                                                android.graphics.Bitmap favicon) {
                if (NavigationPolicy.classify(url) == NavigationPolicy.Route.INTERNAL) {
                    retryUrl = url;
                }
                progress.setVisibility(View.VISIBLE);
            }

            @Override public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                CookieManager.getInstance().flush();
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request,
                                                   WebResourceError error) {
                if (request.isForMainFrame()) {
                    showError("Unable to load the owner inbox. Check your internet connection and try again.");
                }
            }

            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler,
                                                      SslError error) {
                handler.cancel();
                showError("A secure connection could not be established. Please try again later.");
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(PermissionRequest request) {
                if (!CameraPolicy.allowed(request.getOrigin().toString(), web.getUrl(), request.getResources())) {
                    request.deny(); return;
                }
                if (pendingCamera != null) pendingCamera.deny();
                pendingCamera = request;
                if (checkSelfPermission(android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    finishCameraRequest();
                } else requestPermissions(new String[]{android.Manifest.permission.CAMERA}, CAMERA_PERMISSION);
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (pendingCamera == request) pendingCamera = null;
            }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (!NavigationPolicy.trustedOrigin(view.getUrl())) return false;
                if (pendingPhoto != null) pendingPhoto.onReceiveValue(null);
                pendingPhoto = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                try { startActivityForResult(intent, VIN_PHOTO); }
                catch (ActivityNotFoundException error) { pendingPhoto = null; callback.onReceiveValue(null); }
                return true;
            }
            @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!NavigationPolicy.trustedOrigin(origin)) { callback.invoke(origin, false, false); return; }
                if (locationGranted()) { callback.invoke(origin, true, false); return; }
                pendingLocation = callback; pendingLocationOrigin = origin;
                requestPermissions(new String[]{android.Manifest.permission.ACCESS_FINE_LOCATION,
                        android.Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION_PERMISSION);
            }
            @Override public void onProgressChanged(WebView view, int value) {
                progress.setProgress(value);
                if (value == 100) progress.setVisibility(View.GONE);
            }

            @Override public boolean onCreateWindow(WebView view, boolean dialog,
                                                     boolean userGesture, Message result) {
                if (!userGesture) return false;
                WebView popup = new WebView(MainActivity.this);
                popup.getSettings().setJavaScriptEnabled(false);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView ignored,
                                                                      WebResourceRequest request) {
                        String url = request.getUrl().toString();
                        if (url.equals("about:blank")) return false;
                        if (NavigationPolicy.classify(url) == NavigationPolicy.Route.INTERNAL) {
                            loadOwner(url);
                        } else {
                            route(url, true, true);
                        }
                        popup.post(popup::destroy);
                        return true;
                    }
                });
                ((WebView.WebViewTransport) result.obj).setWebView(popup);
                result.sendToTarget();
                return true;
            }
        });
        web.setDownloadListener((url, userAgent, disposition, type, length) -> {
            if (UpdatePolicy.isApk(url) && updates != null && NavigationPolicy.classify(web.getUrl()) == NavigationPolicy.Route.INTERNAL) {
                updates.start(url); return;
            }
            // Attachments use private blob URLs. Keep them inside the authenticated page.
            new AlertDialog.Builder(this).setTitle("Save an attachment")
                    .setMessage("Photos and videos can be viewed here. To save a file, open the owner inbox in your browser and sign in there.")
                    .setPositiveButton("Open browser", (dialog, which) ->
                            openExternal(new Intent(Intent.ACTION_VIEW, Uri.parse(NavigationPolicy.HOME))))
                    .setNegativeButton("Cancel", null).show();
        });
    }

    private void showMenu(View anchor) {
        PopupMenu menu = new PopupMenu(this, anchor);
        menu.getMenu().add(0, 1, 0, "Owner inbox");
        menu.getMenu().add(0, 2, 1, "Refresh");
        menu.getMenu().add(0, 3, 2, "Open in browser");
        menu.getMenu().add(0, 4, 3, "Text service upload link");
        menu.getMenu().add(0, 5, 4, "Notifications");
        menu.getMenu().add(0, 6, 5, "Updates");
        if (updates.hasDownload()) menu.getMenu().add(0, 7, 6, "Downloaded update");
        menu.setOnMenuItemClickListener(item -> {
            if (item.getItemId() == 1) loadOwner(NavigationPolicy.HOME);
            else if (item.getItemId() == 2) loadOwner(retryUrl);
            else if (item.getItemId() == 4) prepareUploadText();
            else if (item.getItemId() == 5) push.settings();
            else if (item.getItemId() == 6) loadOwner(NavigationPolicy.HOME + "#updates");
            else if (item.getItemId() == 7) updates.show();
            else openExternal(new Intent(Intent.ACTION_VIEW, Uri.parse(NavigationPolicy.HOME)));
            return true;
        });
        menu.show();
    }

    private void prepareUploadText() {
        web.evaluateJavascript("(() => { const d = document.getElementById('customer-dialog'); const a = document.getElementById('call-customer'); return d && d.open && a ? a.getAttribute('href') : null; })()", result -> {
            if (destroyed || isFinishing()) return;
            String currentNumber = "";
            try {
                Object value = new JSONTokener(result).nextValue();
                if (value instanceof String && ((String) value).startsWith("tel:")) {
                    currentNumber = ((String) value).substring(4);
                }
            } catch (Exception ignored) { }
            EditText phone = new EditText(this);
            phone.setInputType(InputType.TYPE_CLASS_PHONE);
            phone.setHint("Customer phone number");
            phone.setSingleLine(true);
            phone.setText(currentNumber);
            LinearLayout box = new LinearLayout(this);
            box.setPadding(dp(22), dp(8), dp(22), 0);
            box.addView(phone, new LinearLayout.LayoutParams(-1, -2));
            AlertDialog dialog = new AlertDialog.Builder(this)
                    .setTitle("Text service upload link")
                    .setMessage("Open a text with the link for photos, video, and vehicle location.")
                    .setView(box).setNegativeButton("Cancel", null)
                    .setPositiveButton("Open text message", null).create();
            dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE)
                    .setOnClickListener(button -> {
                        String number = phone.getText().toString().replaceAll("[ ()\\-.]", "");
                        if (NavigationPolicy.classify("sms:" + number) != NavigationPolicy.Route.TEXT) {
                            phone.setError("Enter a valid customer phone number.");
                            return;
                        }
                        String text = "Hi, this is Swagg Daddys. Please share your vehicle details, a photo or short video, and your location here: https://swaggdaddys.com/#request";
                        Intent intent = new Intent(Intent.ACTION_SENDTO,
                                Uri.parse("smsto:" + number));
                        intent.putExtra("sms_body", text);
                        openExternal(intent);
                        dialog.dismiss();
                    }));
            dialog.show();
        });
    }

    private boolean route(String url, boolean mainFrame, boolean userGesture) {
        if (UpdatePolicy.isApk(url)) {
            if (mainFrame && userGesture && updates != null && NavigationPolicy.classify(web.getUrl()) == NavigationPolicy.Route.INTERNAL) updates.start(url);
            return true;
        }
        NavigationPolicy.Route destination = NavigationPolicy.classify(url);
        if (destination == NavigationPolicy.Route.INTERNAL) return false;
        if (!mainFrame) return true;
        if (destination == NavigationPolicy.Route.CALL) {
            openExternal(new Intent(Intent.ACTION_DIAL, Uri.parse(url)));
        } else if (destination == NavigationPolicy.Route.TEXT) {
            openExternal(new Intent(Intent.ACTION_SENDTO, Uri.parse(url)));
        } else if (destination == NavigationPolicy.Route.EXTERNAL) {
            openExternal(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } else {
            Toast.makeText(this, "This link cannot be opened in the app.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void openExternal(Intent intent) {
        try { startActivity(intent); }
        catch (ActivityNotFoundException error) {
            Toast.makeText(this, "No compatible app is installed for this action.", Toast.LENGTH_LONG).show();
        }
    }

    private void loadOwner(String url) {
        if (NavigationPolicy.classify(url) != NavigationPolicy.Route.INTERNAL) return;
        errorPanel.setVisibility(View.GONE);
        web.loadUrl(url);
    }

    private void showError(String message) {
        if (destroyed || isFinishing()) return;
        errorMessage.setText(message);
        errorPanel.setVisibility(View.VISIBLE);
        progress.setVisibility(View.GONE);
    }

    private void handleBack() {
        if (errorPanel.getVisibility() == View.VISIBLE) { finish(); return; }
        // A request is a webpage dialog, not a separate history entry.
        web.evaluateJavascript("(() => { const d = document.querySelector('dialog[open]'); if (d) { d.close(); return true; } return false; })()", result -> {
            if (destroyed || isFinishing() || "true".equals(result)) return;
            if (web.canGoBack()) web.goBack(); else finish();
        });
    }

    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() { handleBack(); }

    @Override protected void onPause() {
        if (push != null) push.pause();
        if (updates != null) updates.pause();
        CookieManager.getInstance().flush();
        web.onPause();
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        if (push != null) push.resume();
        if (updates != null) updates.resume();
    }

    private void finishCameraRequest() {
        PermissionRequest request = pendingCamera;
        pendingCamera = null;
        if (request == null) return;
        if (!destroyed && web != null
                && checkSelfPermission(android.Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED
                && CameraPolicy.allowed(request.getOrigin().toString(), web.getUrl(), request.getResources())) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else request.deny();
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == VIN_PHOTO && pendingPhoto != null) {
            ValueCallback<Uri[]> callback = pendingPhoto; pendingPhoto = null;
            Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
            if (uri != null && !"content".equals(uri.getScheme())) uri = null;
            if (destroyed || web == null || !NavigationPolicy.trustedOrigin(web.getUrl())) uri = null;
            callback.onReceiveValue(uri == null ? null : new Uri[]{uri});
        }
    }

    private boolean locationGranted() {
        return checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(android.Manifest.permission.ACCESS_COARSE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }
    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == CAMERA_PERMISSION) finishCameraRequest();
        if (requestCode == LOCATION_PERMISSION && pendingLocation != null) {
            pendingLocation.invoke(pendingLocationOrigin, locationGranted(), false);
            pendingLocation = null; pendingLocationOrigin = null;
        }
        if(requestCode==OwnerPushController.PERMISSION && push!=null)
            push.permissionResult(results.length>0 && results[0]==android.content.pm.PackageManager.PERMISSION_GRANTED);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        loadOwner(NavigationPolicy.HOME);
    }

    @Override protected void onDestroy() {
        destroyed = true;
        if (pendingCamera != null) { pendingCamera.deny(); pendingCamera = null; }
        if (pendingPhoto != null) { pendingPhoto.onReceiveValue(null); pendingPhoto = null; }
        if (push != null) push.destroy();
        if (updates != null) updates.destroy();
        if (web != null) {
            web.stopLoading();
            web.setWebChromeClient(null);
            web.setWebViewClient(new WebViewClient());
            web.destroy();
        }
        super.onDestroy();
    }
}
