/**
 * Tests for focus management utilities.
 *
 * These tests verify that:
 * 1. saveFocus() captures the currently focused element
 * 2. The returned restore function correctly returns focus
 * 3. Focus restoration handles edge cases (element removed, not focusable)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveFocus } from '../utils/focusManagement';

describe('focusManagement', () => {
    // Mock document and DOM elements
    let mockElement;
    let originalActiveElement;

    beforeEach(() => {
        // Create a mock focusable element
        mockElement = {
            focus: vi.fn(),
            blur: vi.fn(),
        };

        // Store original activeElement getter
        originalActiveElement = Object.getOwnPropertyDescriptor(document, 'activeElement');
    });

    afterEach(() => {
        // Restore original activeElement
        if (originalActiveElement) {
            Object.defineProperty(document, 'activeElement', originalActiveElement);
        }
    });

    describe('saveFocus()', () => {
        it('returns a function', () => {
            const restoreFocus = saveFocus();
            expect(typeof restoreFocus).toBe('function');
        });

        it('captures the currently focused element', () => {
            // Set up activeElement
            Object.defineProperty(document, 'activeElement', {
                get: () => mockElement,
                configurable: true,
            });

            // Mock document.contains to return true
            const originalContains = document.contains;
            document.contains = vi.fn(() => true);

            const restoreFocus = saveFocus();

            // Verify element is still tracked (by calling restore and checking focus was called)
            restoreFocus();

            expect(mockElement.focus).toHaveBeenCalled();

            // Restore original
            document.contains = originalContains;
        });

        it('restores focus when restore function is called', () => {
            Object.defineProperty(document, 'activeElement', {
                get: () => mockElement,
                configurable: true,
            });

            const originalContains = document.contains;
            document.contains = vi.fn(() => true);

            const restoreFocus = saveFocus();
            restoreFocus();

            expect(mockElement.focus).toHaveBeenCalledTimes(1);

            document.contains = originalContains;
        });

        it('handles element that is no longer in the document', () => {
            Object.defineProperty(document, 'activeElement', {
                get: () => mockElement,
                configurable: true,
            });

            // Element is no longer in document
            const originalContains = document.contains;
            document.contains = vi.fn(() => false);

            const restoreFocus = saveFocus();

            // Should not throw, should not call focus
            expect(() => restoreFocus()).not.toThrow();
            expect(mockElement.focus).not.toHaveBeenCalled();

            document.contains = originalContains;
        });

        it('handles null activeElement', () => {
            Object.defineProperty(document, 'activeElement', {
                get: () => null,
                configurable: true,
            });

            const restoreFocus = saveFocus();

            // Should not throw
            expect(() => restoreFocus()).not.toThrow();
        });

        it('uses fallback element when original is unavailable', () => {
            Object.defineProperty(document, 'activeElement', {
                get: () => mockElement,
                configurable: true,
            });

            const originalContains = document.contains;
            // Original not in document, but fallback is
            let callCount = 0;
            document.contains = vi.fn((el) => {
                callCount++;
                // First call is for original (not in doc), second is for fallback (in doc)
                return el !== mockElement;
            });

            const fallbackElement = { focus: vi.fn() };
            const restoreFocus = saveFocus(fallbackElement);
            restoreFocus();

            // Should not call original focus (not in document)
            expect(mockElement.focus).not.toHaveBeenCalled();
            // Should call fallback focus
            expect(fallbackElement.focus).toHaveBeenCalledTimes(1);

            document.contains = originalContains;
        });

        it('blurs active element when no valid target found', () => {
            const activeElementWithBlur = {
                blur: vi.fn(),
            };

            Object.defineProperty(document, 'activeElement', {
                get: () => activeElementWithBlur,
                configurable: true,
            });

            const originalContains = document.contains;
            document.contains = vi.fn(() => false);

            const restoreFocus = saveFocus();

            // Set a different activeElement for the blur check
            Object.defineProperty(document, 'activeElement', {
                get: () => activeElementWithBlur,
                configurable: true,
            });

            restoreFocus();

            expect(activeElementWithBlur.blur).toHaveBeenCalled();

            document.contains = originalContains;
        });
    });

    describe('Modal focus restoration pattern', () => {
        /**
         * This test documents the expected usage pattern for modal components.
         */
        it('correctly restores focus after modal close', () => {
            // Simulate: user clicks button, button is focused, modal opens
            const buttonElement = { focus: vi.fn() };
            let currentActiveElement = buttonElement;

            Object.defineProperty(document, 'activeElement', {
                get: () => currentActiveElement,
                configurable: true,
            });

            const originalContains = document.contains;
            document.contains = vi.fn(() => true);

            // Modal opens - save the focus
            const restoreFocus = saveFocus();

            // Modal gets focus (simulate)
            const modalInput = { focus: vi.fn() };
            currentActiveElement = modalInput;

            // User closes modal - restore focus
            restoreFocus();

            // Original button should be focused
            expect(buttonElement.focus).toHaveBeenCalled();

            document.contains = originalContains;
        });

        it('handles rapid modal open/close', () => {
            const element = { focus: vi.fn() };

            Object.defineProperty(document, 'activeElement', {
                get: () => element,
                configurable: true,
            });

            const originalContains = document.contains;
            document.contains = vi.fn(() => true);

            // Rapid open/close sequence
            const restore1 = saveFocus();
            const restore2 = saveFocus();
            const restore3 = saveFocus();

            // Close in reverse order
            restore3();
            restore2();
            restore1();

            // Focus should have been called 3 times
            expect(element.focus).toHaveBeenCalledTimes(3);

            document.contains = originalContains;
        });
    });
});
