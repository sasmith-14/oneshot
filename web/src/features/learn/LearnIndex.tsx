import { Link } from "react-router";
import { motion } from "motion/react";
import { ArrowUpRight } from "lucide-react";
import { PageHeader, Section } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useDocs } from "@/hooks/queries";
import { EASE_OUT } from "@/lib/motion";
import { LifeOfAnAction } from "./LifeOfAnAction";

export function LearnIndex() {
  const docs = useDocs();
  return (
    <>
      <PageHeader title="Learn">
        How OneShot keeps its promises, and where it cannot. Scroll through the life of one action first; then read the concept documents. They are the same sources the PDFs are built from, so the two never disagree.
      </PageHeader>
      <Section title="The life of one action" about="A text message whose reply gets lost, and every branch it could take. Scroll, and the diagram follows the story.">
        <LifeOfAnAction />
      </Section>
      <Section title="Concept documents" about="Each covers the problem, diagrams including failure paths, the code that implements it, real test output, and what it cannot protect against.">
        {!docs.data ? (
          <Skeleton className="h-64 rounded-[12px]" />
        ) : (
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {docs.data.map((d, i) => {
              const [num, ...rest] = d.title.split(" · ");
              const title = rest.length ? rest.join(" · ") : d.title;
              return (
                <motion.li key={d.slug} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.4, delay: Math.min(i, 6) * 0.04, ease: EASE_OUT }}>
                  <Link to={`/learn/${d.slug}`} className="panel group flex h-full flex-col p-[18px] transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-strong" aria-label={d.title}>
                    <span className="flex items-center justify-between">
                      <span className="chip font-mono">{rest.length ? num : "notes"}</span>
                      <ArrowUpRight aria-hidden className="size-4 text-fg-3 transition-[color,transform] duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-signal" />
                    </span>
                    <span className="mt-6 text-[16px] leading-snug font-[620] tracking-[-0.015em]">{title}</span>
                    <span className="mt-1.5 text-[12.5px] text-fg-3">{Math.max(1, Math.round(d.words / 230))} min read</span>
                  </Link>
                </motion.li>
              );
            })}
          </ol>
        )}
      </Section>
    </>
  );
}
