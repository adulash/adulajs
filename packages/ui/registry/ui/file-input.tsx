import * as React from "react";
import { FileUp } from "lucide-react";
import { cn } from "cn";
import { Button } from "~/components/ui/button";
import { useMessages } from "~/components/ui/messages";

type FileInputProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "onChange"
> & {
  id: string;
  /** The id of the field's label, read with the button so keyboard users hear the field name. */
  labelId?: string;
  /** Called with the chosen files; an empty list when the choice is cleared. */
  onFilesChange?: (files: File[]) => void;
};

/**
 * A file field in the interface language: a button that opens the file picker and the name of
 * the chosen file, instead of the browser's native control and its untranslated text. The native
 * input stays in the document, hidden, so a `<Label htmlFor={id}>` still names it and forms and
 * tests can set its files; keyboard users reach the button, which `labelId` describes.
 */
function FileInput({
  id,
  labelId,
  className,
  disabled,
  multiple,
  onFilesChange,
  "aria-describedby": describedBy,
  ...props
}: FileInputProps) {
  const { t } = useMessages();
  const input = React.useRef<HTMLInputElement>(null);
  const [names, setNames] = React.useState<string[]>([]);
  const chosen = names.length ? names.join("، ") : t("لم يُختر أي ملف");
  return (
    <div
      data-slot="file-input"
      className={cn(
        "flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-transparent ps-1 pe-3 shadow-xs dark:bg-input/30",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <input
        {...props}
        ref={input}
        id={id}
        type="file"
        multiple={multiple}
        disabled={disabled}
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          setNames(files.map((file) => file.name));
          onFilesChange?.(files);
        }}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-7"
        disabled={disabled}
        aria-describedby={[labelId, `${id}-chosen`].filter(Boolean).join(" ")}
        onClick={() => input.current?.click()}
      >
        <FileUp size={14} aria-hidden="true" />
        {names.length ? t("تغيير الملف") : t("اختيار ملف")}
      </Button>
      <span
        id={`${id}-chosen`}
        data-slot="file-input-name"
        aria-live="polite"
        className={cn(
          "min-w-0 truncate text-sm",
          names.length ? "text-foreground" : "text-muted-foreground",
        )}
        title={names.join("، ") || undefined}
      >
        {chosen}
      </span>
    </div>
  );
}

export { FileInput };
