//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa

#import <Cocoa/Cocoa.h>
#include <stdlib.h>

// ReadClipboardImageAsPNG reads any image from the clipboard and returns it as PNG data.
// Supports TIFF, PNG, and other image formats that macOS can handle.
// Returns NULL if no image is present.
void* ReadClipboardImageAsPNG(int* outLen) {
    @autoreleasepool {
        NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];

        // Try to read image data (handles TIFF, PNG, and other formats)
        NSData *imageData = [pasteboard dataForType:NSPasteboardTypeTIFF];
        if (imageData == nil) {
            imageData = [pasteboard dataForType:NSPasteboardTypePNG];
        }
        if (imageData == nil) {
            *outLen = 0;
            return NULL;
        }

        // Convert to NSImage, then to PNG
        NSImage *image = [[NSImage alloc] initWithData:imageData];
        if (image == nil) {
            *outLen = 0;
            return NULL;
        }

        // Get PNG representation
        NSBitmapImageRep *rep = [NSBitmapImageRep imageRepWithData:[image TIFFRepresentation]];
        if (rep == nil) {
            *outLen = 0;
            return NULL;
        }

        NSData *pngData = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        if (pngData == nil || [pngData length] == 0) {
            *outLen = 0;
            return NULL;
        }

        // Copy to C memory that Go can manage
        *outLen = (int)[pngData length];
        void *result = malloc(*outLen);
        memcpy(result, [pngData bytes], *outLen);
        return result;
    }
}

void FreeClipboardData(void* data) {
    free(data);
}
*/
import "C"

// readClipboardImageNative reads image from macOS clipboard using native APIs.
// Supports TIFF (screenshot format), PNG, and other image formats.
// Returns PNG-encoded data or nil if no image is present.
func readClipboardImageNative() ([]byte, error) {
	var length C.int
	ptr := C.ReadClipboardImageAsPNG(&length)

	if ptr == nil || length == 0 {
		return nil, nil
	}
	defer C.FreeClipboardData(ptr)

	return C.GoBytes(ptr, length), nil
}
