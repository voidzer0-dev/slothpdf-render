import { render } from "@slothpdf/render";

const template = `
  <Page size="A4" margin="20mm">
    <Box class="text-2xl font-bold mb-4">{name}</Box>
    <Box class="text-sm text-gray-600">{description}</Box>
  </Page>
`;

const data = { name: "John", description: "Hello World" };

await Bun.write("output.pdf", render(template, data));
